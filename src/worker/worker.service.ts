import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { GeofencingGateway } from '../admin/project/geofencing.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import type { File as MulterFile } from 'multer';
import {
  SubmitTaskReportDto,
  CheckInDto,
  CheckOutDto,
  CreateLeaveRequestDto,
  UpdateProfileDto,
  ChangePasswordDto,
  CreateSupportRequestDto,
  UpdateLocationDto,
  UpdateTaskInventoryDto,
} from './dto/worker.dto';

@Injectable()
export class WorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geofencingGateway: GeofencingGateway,
    private readonly notificationsService: NotificationsService,
  ) { }

  private formatHoursAndMinutes(hours: number) {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${m}m`;
  }

  private isWorkerAssigned(task: { assignedTo?: string | null; taskAssignees?: { userId: string }[] }, workerId: string) {
    return task.assignedTo === workerId || (task.taskAssignees?.some((assignment) => assignment.userId === workerId) ?? false);
  }

  private workerTaskWhere(workerId: string) {
    return {
      OR: [
        { assignedTo: workerId },
        { taskAssignees: { some: { userId: workerId } } },
      ],
    };
  }

  private async syncDailyPayrollDraft(workerId: string, attendanceDate: Date, totalZoneHours: number) {
    const membership = await this.prisma.projectMember.findFirst({
      where: { userId: workerId },
      include: {
        project: {
          select: { id: true, name: true, companyId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!membership?.project?.companyId) {
      return null;
    }

    const companyId = membership.project.companyId;
    const payrollConfig = await this.prisma.payrollConfig.findUnique({
      where: { companyId },
    });

    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { hourlyRate: true },
    });

    const existingPayroll = await this.prisma.payroll.findFirst({
      where: {
        workerId,
        companyId,
        projectId: membership.project.id,
        payPeriodStart: attendanceDate,
        payPeriodEnd: attendanceDate,
      },
      orderBy: { createdAt: 'desc' },
    });

    const effectiveRate = existingPayroll?.ratePerHour ?? worker?.hourlyRate ?? 0;
    const grossPay = Math.round((totalZoneHours * effectiveRate) * 100) / 100;
    const deductions = existingPayroll?.deductions ?? 0;
    const netPay = Math.round((grossPay - deductions) * 100) / 100;
    const employerCost = existingPayroll?.employerCost ?? grossPay;

    const data = {
      companyId,
      workerId,
      projectId: membership.project.id,
      payPeriodStart: attendanceDate,
      payPeriodEnd: attendanceDate,
      regularHours: totalZoneHours,
      overtimeHours: 0,
      ratePerHour: effectiveRate,
      grossPay,
      deductions,
      netPay,
      employerCost,
      status: 'draft' as const,
      processedBy: null,
      processedAt: null,
    };

    if (existingPayroll) {
      return this.prisma.payroll.update({
        where: { id: existingPayroll.id },
        data,
      });
    }

    return this.prisma.payroll.create({
      data,
    });
  }

  // ─────────────────────────────────────────────
  // DASHBOARD
  // ─────────────────────────────────────────────

  async getDashboard(workerId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    // today's assigned tasks
    const [
      todayTasks,
      completedToday,
      attendance,
      thisWeekSchedule,
    ] = await Promise.all([
      // today tasks (due today or in_progress)
      this.prisma.task.findMany({
        where: {
          ...this.workerTaskWhere(workerId),
          OR: [
            { dueDate: { gte: today, lte: todayEnd } },
            { status: 'in_progress' },
            { status: 'pending' },
            { status: 'review' },
          ],
        },
        select: {
          id: true,
          title: true,
          priority: true,
          status: true,
          dueDate: true,
          project: { select: { id: true, name: true } },
          floor: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
          _count: { select: { reports: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      // today completed tasks
      this.prisma.task.count({
        where: {
          ...this.workerTaskWhere(workerId),
          status: 'completed',
          updatedAt: { gte: today, lte: todayEnd },
        },
      }),

      //  attendance (check-in/out status)
      this.prisma.attendance.findFirst({
        where: { userId: workerId, date: today },
        include: { sessions: true },
      }),

      //  schedule (WorkScheduleAssignment)
      this.prisma.workScheduleAssignment.findMany({
        where: { userId: workerId },
        include: {
          schedule: true,
        },
        take: 5,
      }),
    ]);

    // Clock in/out status
    let clockStatus = 'not_clocked_in';
    let clockInTime: Date | null = null;
    if (attendance) {
      const openSession = attendance.sessions?.find((s) => !s.checkOutTime);
      if (openSession) {
        clockStatus = 'clocked_in';
        clockInTime = openSession.checkInTime;
      } else if (attendance.sessions?.length > 0) {
        clockStatus = 'clocked_out';
      }
    }

    return {
      stats: {
        todayTasksCount: todayTasks.length,
        completedToday,
        clockStatus,
        clockInTime,
        hoursWorked: attendance?.totalHours ?? null,
      },
      todayTasks,
      thisWeekSchedule: thisWeekSchedule.map((s) => ({
        id: s.schedule.id,
        name: s.schedule.name,
        days: s.schedule.days,
        startTime: s.schedule.startTime,
        endTime: s.schedule.endTime,
      })),
    };
  }

  // ─────────────────────────────────────────────
  // TASKS
  // ─────────────────────────────────────────────

  async getMyTasks(
    workerId: string,
    status?: string,
    search?: string,
    page = 1,
    limit = 10,
  ) {
    const skip = (page - 1) * limit;

    const andConditions: any[] = [];

    if (status) {
      andConditions.push({
        OR: [{ status: status as any }, { status: 'review' }],
      });
    }

    if (search) {
      andConditions.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const where: any = {
      assignedTo: workerId,
      ...(andConditions.length > 0 && { AND: andConditions }),
    };

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          floor: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
          _count: { select: { reports: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTaskDetail(taskId: string, workerId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            location: true,
            geofences: {
              where: { isActive: true },
              select: { id: true, zoneName: true, polygonCoords: true },
            }
          },
        },
        floor: { select: { id: true, name: true, floorNumber: true } },
        room: { select: { id: true, name: true, type: true } },
        creator: { select: { id: true, fullName: true, avatarUrl: true } },
        reports: {
          orderBy: { submittedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            notes: true,
            beforePhotoUrl: true,
            afterPhotoUrl: true,
            receiptUrl: true,
            reviewDecision: true,
            reviewDescription: true,
            submittedAt: true,
          },
        },
        taskInventories: {
          include: {
            inventory: { select: { id: true, name: true, unit: true, currentQty: true } },
          },
        },
      },
    });

    if (!task) throw new NotFoundException('Task not found');
    if (!this.isWorkerAssigned(task, workerId))
      throw new ForbiddenException('This task is not assigned to you');

    return task;
  }

  async startTask(taskId: string, workerId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });

    if (!task) throw new NotFoundException('Task not found');
    if (!this.isWorkerAssigned(task, workerId))
      throw new ForbiddenException('This task is not assigned to you');
    if (task.status === 'in_progress') {
      return this.prisma.task.findUnique({
        where: { id: taskId },
        include: {
          project: { select: { id: true, name: true } },
          floor: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
        },
      });
    }
    if (task.status !== 'pending')
      throw new BadRequestException(`Task is already ${task.status}`);

    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'in_progress' },
      include: {
        project: { select: { id: true, name: true } },
        floor: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
      },
    });
  }

  async submitTaskReport(
    taskId: string,
    workerId: string,
    dto: SubmitTaskReportDto,
    files?: {
      beforePhoto?: MulterFile[];
      afterPhoto?: MulterFile[];
      receipt?: MulterFile[];
    },
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });

    if (!task) throw new NotFoundException('Task not found');
    if (!this.isWorkerAssigned(task, workerId))
      throw new ForbiddenException('This task is not assigned to you');
    if (task.status === 'completed')
      throw new BadRequestException('Task is already completed');

    // Inventory usage log 
    if (dto.inventoryUsed && dto.inventoryUsed.length > 0) {
      for (const item of dto.inventoryUsed) {
        const inv = await this.prisma.inventoryItem.findUnique({
          where: { id: item.inventoryId },
        });
        if (!inv) throw new NotFoundException(`Inventory item not found: ${item.inventoryId}`);
        if (inv.currentQty < item.qtyUsed)
          throw new BadRequestException(`Not enough stock for: ${inv.name}`);

        // Stock কমাও + log করো
        await this.prisma.$transaction([
          this.prisma.inventoryItem.update({
            where: { id: item.inventoryId },
            data: { currentQty: { decrement: item.qtyUsed } },
          }),
          this.prisma.inventoryUsageLog.create({
            data: {
              inventoryId: item.inventoryId,
              userId: workerId,
              projectId: task.projectId,
              qtyChange: -item.qtyUsed,
              reason: `Used in task: ${task.title}`,
            },
          }),
          this.prisma.taskInventory.create({
            data: {
              taskId,
              inventoryId: item.inventoryId,
              qtyUsed: item.qtyUsed,
            },
          }),
        ]);
      }
    }

    // Task report create 
    const report = await this.prisma.taskReport.create({
      data: {
        taskId,
        workerId,
        notes: dto.notes ?? null,
        beforePhotoUrl: files?.beforePhoto?.[0]?.filename
          ? `/uploads/task-reports/${files.beforePhoto[0].filename}`
          : dto.beforePhotoUrl ?? null,
        afterPhotoUrl: files?.afterPhoto?.[0]?.filename
          ? `/uploads/task-reports/${files.afterPhoto[0].filename}`
          : dto.afterPhotoUrl ?? null,
        receiptUrl: files?.receipt?.[0]?.filename
          ? `/uploads/task-reports/${files.receipt[0].filename}`
          : dto.receiptUrl ?? null,
        reviewDecision: 'pending',
      },
    });

    const taskWithProject = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { include: { company: true } } },
    });

    if (taskWithProject?.project?.company?.ownerId) {
      await this.notificationsService.send({
        userId: taskWithProject.project.company.ownerId,
        title: 'New Task Report Submitted',
        body: `A worker submitted a report for task: ${taskWithProject.title}`,
        type: 'report',
        refId: taskId,
        refType: 'task',
      });
    }

    // Task status → in_progress এ রাখো
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'in_progress' },
    });

    return {
      message: 'Task report submitted successfully. Task is still in progress.',
      report,
    };
  }

  async updateTaskReport(taskId: string, workerId: string, body: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });

    if (!task) throw new NotFoundException('Task not found');
    if (!this.isWorkerAssigned(task, workerId))
      throw new ForbiddenException('This task is not assigned to you');

    const report = await this.prisma.taskReport.findFirst({
      where: { taskId, workerId },
      orderBy: { submittedAt: 'desc' },
    });

    if (!report) throw new NotFoundException('Task report not found');

    const updatedReport = await this.prisma.taskReport.update({
      where: { id: report.id },
      data: {
        notes: body?.notes ?? report.notes,
        beforePhotoUrl: body?.beforePhotoUrl ?? report.beforePhotoUrl,
        afterPhotoUrl: body?.afterPhotoUrl ?? report.afterPhotoUrl,
        receiptUrl: body?.receiptUrl ?? report.receiptUrl,
      },
    });

    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'completed' },
    });

    return {
      message: 'Task report updated successfully. Task completed.',
      report: updatedReport,
    };
  }

  // project এর available inventory items
  async getTaskInventoryItems(taskId: string, workerId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { include: { company: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (!this.isWorkerAssigned(task, workerId))
      throw new ForbiddenException('This task is not assigned to you');

    return this.prisma.inventoryItem.findMany({
      where: {
        projectId: task.project.id,
        currentQty: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        category: true,
        currentQty: true,
        unit: true,
        location: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  // ─────────────────────────────────────────────
  // ATTENDANCE
  // ─────────────────────────────────────────────

  async updateTaskInventoryItem(
    taskId: string,
    inventoryId: string,
    workerId: string,
    dto: UpdateTaskInventoryDto,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { select: { id: true, name: true } } },
    });

    if (!task) throw new NotFoundException('Task not found');
    if (!this.isWorkerAssigned(task, workerId)) {
      throw new ForbiddenException('This task is not assigned to you');
    }

    if (task.status === 'completed') {
      throw new BadRequestException('Completed task inventory cannot be updated');
    }

    const inventory = await this.prisma.inventoryItem.findFirst({
      where: {
        id: inventoryId,
        projectId: task.projectId,
      },
    });

    if (!inventory) {
      throw new NotFoundException('Inventory item not found');
    }

    const existingTaskInventory = await this.prisma.taskInventory.findFirst({
      where: {
        taskId,
        inventoryId,
      },
    });

    const previousQty = existingTaskInventory?.qtyUsed ?? 0;
    const nextQty = dto.qtyUsed;
    const stockDelta = nextQty - previousQty;

    if (stockDelta > 0 && inventory.currentQty < stockDelta) {
      throw new BadRequestException(
        `Not enough stock for: ${inventory.name}. Available: ${inventory.currentQty}, requested additional: ${stockDelta}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedInventory = await tx.inventoryItem.update({
        where: { id: inventoryId },
        data: {
          currentQty:
            stockDelta > 0
              ? { decrement: stockDelta }
              : { increment: Math.abs(stockDelta) },
        },
      });

      await tx.inventoryUsageLog.create({
        data: {
          inventoryId,
          userId: workerId,
          projectId: task.projectId,
          qtyChange: -stockDelta,
          reason: dto.reason ?? `Updated task inventory for ${task.title}`,
        },
      });

      const taskInventory = existingTaskInventory
        ? await tx.taskInventory.update({
            where: { id: existingTaskInventory.id },
            data: { qtyUsed: nextQty },
          })
        : await tx.taskInventory.create({
            data: {
              taskId,
              inventoryId,
              qtyUsed: nextQty,
            },
          });

      return { taskInventory, updatedInventory };
    });

    return {
      message: 'Task inventory updated successfully',
      data: {
        id: result.taskInventory.id,
        taskId: result.taskInventory.taskId,
        inventoryId: result.taskInventory.inventoryId,
        qtyUsed: result.taskInventory.qtyUsed,
        inventory: {
          id: result.updatedInventory.id,
          name: result.updatedInventory.name,
          category: result.updatedInventory.category,
          currentQty: result.updatedInventory.currentQty,
          unit: result.updatedInventory.unit,
          location: result.updatedInventory.location,
        },
      },
    };
  }

  async checkIn(workerId: string, dto: CheckInDto) {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { fullName: true, avatarUrl: true },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // আজকের Attendance record খোঁজো বা বানাও
    const attendance = await this.prisma.attendance.upsert({
      where: { userId_date: { userId: workerId, date: today } },
      update: { status: 'present' },
      create: {
        userId: workerId,
        date: today,
        status: 'present',
      },
      include: { sessions: true },
    });

    // যদি কোনো session এখনো open থাকে (checkout হয়নি) → একই session রিটার্ন করো
    const openSession = attendance.sessions.find((s) => !s.checkOutTime);
    if (openSession) {
      return {
        message: 'Already checked in',
        session: openSession,
        totalSessionsToday: attendance.sessions.length,
      };
    }

    // নতুন session তৈরি করো
    const session = await this.prisma.attendanceSession.create({
      data: {
        attendanceId: attendance.id,
        checkInTime: new Date(),
        inLat: dto.lat ?? null,
        inLng: dto.lng ?? null,
      },
    });

    // Location log
    if (dto.lat && dto.lng) {
      await this.prisma.locationLog.create({
        data: {
          userId: workerId,
          lat: dto.lat,
          lng: dto.lng,
          eventType: 'enter',
        },
      });
    }

    const memberships = await this.prisma.projectMember.findMany({
      where: { userId: workerId },
      select: { projectId: true },
    });

    await Promise.all(memberships.map(async ({ projectId }) => {
      const zoneResult =
        dto.lat != null && dto.lng != null
          ? await this.geofencingGateway.resolveZoneStatus(dto.lat, dto.lng, projectId)
          : { inside: false, zoneName: null };

      const stateResult = this.geofencingGateway.upsertWorkerState({
        userId: workerId,
        fullName: worker?.fullName ?? 'Worker',
        avatarUrl: worker?.avatarUrl ?? null,
        projectId,
        lat: dto.lat ?? 0,
        lng: dto.lng ?? 0,
        isInsideZone: zoneResult.inside,
        zoneName: zoneResult.zoneName,
        status: zoneResult.inside ? 'inside' : 'outside',
        trackingActive: true,
      });

      if (!stateResult.changed) return;

      this.geofencingGateway.emitWorkerLocation(projectId, {
        workerId,
        workerName: worker?.fullName,
        avatarUrl: worker?.avatarUrl ?? null,
        lat: dto.lat ?? 0,
        lng: dto.lng ?? 0,
        isInsideZone: zoneResult.inside,
        zoneName: zoneResult.zoneName,
        status: zoneResult.inside ? 'inside' : 'outside',
        trackingActive: true,
        timestamp: new Date(),
      });
    }));

    return {
      message: 'Checked in successfully',
      session,
      totalSessionsToday: attendance.sessions.length + 1,
    };
  }

  async checkOut(workerId: string, dto: CheckOutDto) {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { fullName: true, avatarUrl: true },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId: workerId, date: today } },
      include: { sessions: true },
    });

    if (!attendance) {
      throw new BadRequestException('You have not checked in today');
    }

    // সবচেয়ে শেষের open session খোঁজো
    const openSession = attendance.sessions
      .filter((s) => !s.checkOutTime)
      .sort((a, b) => b.checkInTime.getTime() - a.checkInTime.getTime())[0];

    if (!openSession) {
      const latestSession = attendance.sessions
        .slice()
        .sort((a, b) => b.checkInTime.getTime() - a.checkInTime.getTime())[0];

      if (latestSession?.checkOutTime) {
        return {
          message: 'Already checked out',
          session: latestSession,
          totalHoursToday: Math.round((attendance.totalHours ?? 0) * 100) / 100,
        };
      }

      throw new ConflictException('No active check-in found. Please check in first.');
    }

    const now = new Date();
    const sessionZoneSeconds = openSession.zoneSeconds ?? 0;
    const hoursWorked = sessionZoneSeconds / 3600;

    // Session close করো
    const updatedSession = await this.prisma.attendanceSession.update({
      where: { id: openSession.id },
      data: {
        checkOutTime: now,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
        outLat: dto.lat ?? null,
        outLng: dto.lng ?? null,
      },
    });

    // update এর পরে fetch করো — না হলে পুরনো hoursWorked যোগ হবে
    const allSessions = await this.prisma.attendanceSession.findMany({
      where: { attendanceId: attendance.id },
    });

    // শুধু closed session এর zone time যোগ করো
    const totalHours = allSessions
      .filter((s) => s.checkOutTime !== null)
      .reduce((sum, s) => sum + ((s.zoneSeconds ?? 0) / 3600), 0);

    await this.prisma.attendance.update({
      where: { id: attendance.id },
      data: { totalHours: Math.round(totalHours * 100) / 100 },
    });

    await this.syncDailyPayrollDraft(workerId, today, Math.round(totalHours * 100) / 100);

    // Location log
    if (dto.lat && dto.lng) {
      await this.prisma.locationLog.create({
        data: {
          userId: workerId,
          lat: dto.lat,
          lng: dto.lng,
          eventType: 'exit',
        },
      });
    }

    const memberships = await this.prisma.projectMember.findMany({
      where: { userId: workerId },
      select: { projectId: true },
    });

    memberships.forEach(({ projectId }) => {
      this.geofencingGateway.upsertWorkerState({
        userId: workerId,
        fullName: worker?.fullName ?? 'Worker',
        avatarUrl: worker?.avatarUrl ?? null,
        projectId,
        lat: dto.lat ?? 0,
        lng: dto.lng ?? 0,
        isInsideZone: false,
        zoneName: null,
        status: 'outside',
        trackingActive: false,
      });

      this.geofencingGateway.server.to(`project_${projectId}`).emit('location_sharing_stopped', {
        workerId,
        workerName: worker?.fullName ?? 'Worker',
        stoppedAt: new Date(),
      });
    });

    return {
      message: 'Checked out successfully',
      session: updatedSession,
      totalHoursToday: Math.round(totalHours * 100) / 100,
    };
  }

  async getTodayAttendance(workerId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId: workerId, date: today } },
      include: {
        sessions: { orderBy: { checkInTime: 'asc' } },
      },
    });

    if (!attendance) {
      return { date: today, status: 'not_recorded', sessions: [], totalHours: 0 };
    }

    const openSession = attendance.sessions.find((s) => !s.checkOutTime);

    return {
      date: today,
      status: openSession ? 'clocked_in' : 'clocked_out',
      sessions: attendance.sessions,
      totalHours: attendance.totalHours ?? 0,
      currentSessionStart: openSession?.checkInTime ?? null,
    };
  }

  async getAttendanceHistory(workerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { userId: workerId },
        include: {
          sessions: { orderBy: { checkInTime: 'asc' } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.attendance.count({ where: { userId: workerId } }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
  // ─────────────────────────────────────────────
  // LEAVE REQUESTS
  // ─────────────────────────────────────────────

  async createLeaveRequest(workerId: string, dto: CreateLeaveRequestDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate > endDate)
      throw new BadRequestException('Start date cannot be after end date');

    // Already pending leave  same period এ
    const conflict = await this.prisma.leaveRequest.findFirst({
      where: {
        userId: workerId,
        status: 'pending',
        OR: [
          { startDate: { lte: endDate }, endDate: { gte: startDate } },
        ],
      },
    });
    if (conflict)
      throw new ConflictException('You already have a pending leave request for this period');

    const leaveRequest = await this.prisma.leaveRequest.create({
      data: {
        userId: workerId,
        leaveType: dto.leaveType,
        startDate,
        endDate,
        reason: dto.reason ?? null,
        status: 'pending',
      },
    });

    const managerMap = await this.prisma.workerManagerMap.findUnique({
      where: { workerId },
      include: { manager: { select: { id: true } } },
    });
    if (managerMap?.manager?.id) {
      await this.notificationsService.send({
        userId: managerMap.manager.id,
        title: 'New Leave Request',
        body: `A worker has submitted a leave request.`,
        type: 'attendance',
        refId: leaveRequest.id,
        refType: 'leave_request',
      });
    }

    return leaveRequest;
  }

  async getMyLeaveRequests(workerId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { userId: workerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelLeaveRequest(leaveId: string, workerId: string) {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id: leaveId, userId: workerId },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== 'pending')
      throw new BadRequestException('Only pending requests can be cancelled');

    return this.prisma.leaveRequest.update({
      where: { id: leaveId },
      data: { status: 'cancelled' },
    });
  }

  // ─────────────────────────────────────────────
  // PROFILE
  // ─────────────────────────────────────────────

  async getProfile(workerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        status: true,
        employeeId: true,
        department: true,
        dateOfBirth: true,
        address: true,
        bio: true,
        hourlyRate: true,
        joinDate: true,
        lastLoginAt: true,
        createdAt: true,
        emergencyContacts: true,
        certifications: true,
        userSettings: true,
        companyMembers: {
          include: { company: { select: { id: true, name: true, logoUrl: true } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(workerId: string, dto: UpdateProfileDto, avatarFile?: MulterFile) {
    return this.prisma.user.update({
      where: { id: workerId },
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        address: dto.address,
        avatarUrl: avatarFile
          ? `/uploads/avatars/${avatarFile.filename}`
          : dto.avatarUrl,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        dateOfBirth: true,
        address: true,
      },
    });
  }

  async changePassword(workerId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: workerId } });
    if (!user) throw new NotFoundException('User not found');

    const isMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isMatch)
      throw new BadRequestException('Current password is incorrect');

    const newHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: workerId },
      data: { passwordHash: newHash },
    });

    return { message: 'Password updated successfully' };
  }

  // ─────────────────────────────────────────────
  // SUPPORT REQUEST
  // ─────────────────────────────────────────────

  async createSupportRequest(workerId: string, dto: CreateSupportRequestDto) {
    let targetUserId: string | null = null;

    if (dto.sendTo === 'manager') {
      const managerMap = await this.prisma.workerManagerMap.findUnique({
        where: { workerId },
        include: { manager: { select: { id: true } } },
      });
      targetUserId = managerMap?.manager?.id ?? null;
    } else {
      // Admin — worker  company    owner
      const companyMember = await this.prisma.companyMember.findFirst({
        where: { userId: workerId },
        include: { company: { select: { ownerId: true } } },
      });
      targetUserId = companyMember?.company?.ownerId ?? null;
    }

    if (!targetUserId)
      throw new NotFoundException(`No ${dto.sendTo} found for your account`);

    // Notification হিসেবে পাঠাও
    const notification = await this.prisma.notification.create({
      data: {
        userId: targetUserId,
        title: `Support Request from Worker`,
        body: dto.message,
        type: 'general',
        refId: workerId,
        refType: 'support_request',
      },
    });

    return { message: 'Support request sent successfully', notification };
  }

  // ─────────────────────────────────────────────
  // LOCATION UPDATE
  // ─────────────────────────────────────────────

  async updateLocation(workerId: string, dto: UpdateLocationDto) {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { fullName: true, avatarUrl: true },
    });

    const log = await this.prisma.locationLog.create({
      data: {
        userId: workerId,
        lat: dto.lat,
        lng: dto.lng,
        geofenceId: dto.geofenceId ?? null,
        eventType: dto.eventType ?? 'update',
      },
    });

    let isInsideZone = false;
    let zoneName: string | null = null;

    // Geofence violation check
    if (dto.geofenceId) {
      const geofence = await this.prisma.geofence.findUnique({
        where: { id: dto.geofenceId },
      });

      if (geofence) {
  const coords = Array.isArray(geofence.polygonCoords)
    ? (geofence.polygonCoords as { lat: number; lng: number }[])
    : [];

  const isInside =
    coords.length >= 3
      ? this.pointInPolygon(dto.lat, dto.lng, coords)
      : false;

  isInsideZone = isInside;
  zoneName = geofence.zoneName;

  if (!isInside) {
    await this.prisma.geofenceViolation.create({
      data: {
        geofenceId: dto.geofenceId,
        userId: workerId,
        distanceM: 0,
        description: `Worker is outside the zone: ${geofence.zoneName}`,
      },
    });
  }
}
    }

    const projectIds = new Set<string>();

    if (dto.geofenceId) {
      const geofence = await this.prisma.geofence.findUnique({
        where: { id: dto.geofenceId },
        select: { projectId: true },
      });
      if (geofence?.projectId) projectIds.add(geofence.projectId);
    }

    const memberships = await this.prisma.projectMember.findMany({
      where: { userId: workerId },
      select: { projectId: true },
    });
    memberships.forEach((m) => projectIds.add(m.projectId));

    for (const projectId of projectIds) {
      this.geofencingGateway.upsertWorkerState({
        userId: workerId,
        fullName: worker?.fullName ?? 'Worker',
        avatarUrl: worker?.avatarUrl ?? null,
        projectId,
        lat: dto.lat,
        lng: dto.lng,
        isInsideZone,
        zoneName,
        status: isInsideZone ? 'inside' : 'outside',
      });

      this.geofencingGateway.emitWorkerLocation(projectId, {
        workerId,
        workerName: worker?.fullName,
        avatarUrl: worker?.avatarUrl ?? null,
        lat: dto.lat,
        lng: dto.lng,
        isInsideZone,
        zoneName,
        status: isInsideZone ? 'inside' : 'outside',
        timestamp: new Date(),
      });
    }

    return { message: 'Location updated', log };
  }

  // ─────────────────────────────────────────────
  // NOTIFICATIONS
  // ─────────────────────────────────────────────

  async getMyNotifications(workerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [data, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: workerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId: workerId } }),
      this.prisma.notification.count({ where: { userId: workerId, isRead: false } }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), unreadCount },
    };
  }

  async markNotificationsRead(workerId: string) {
    await this.prisma.notification.updateMany({
      where: { userId: workerId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'All notifications marked as read' };
  }

  // ─────────────────────────────────────────────
  // PAYROLL
  // ─────────────────────────────────────────────

  async getMyPayroll(workerId: string, date?: string) {
    // selected date er start & end
    const selected = date ? new Date(date) : new Date();
    selected.setHours(0, 0, 0, 0);
    const selectedEnd = new Date(selected);
    selectedEnd.setHours(23, 59, 59, 999);

    const [payrolls, attendanceRecord] = await Promise.all([
      // sei diner moddhe payPeriodStart theke payPeriodEnd er moddhe pore emon payroll
      this.prisma.payroll.findMany({
        where: {
          workerId,
          payPeriodStart: { lte: selectedEnd },
          payPeriodEnd: { gte: selected },
        },
        include: {
          company: { select: { id: true, name: true, logoUrl: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // sei diner attendance (total hours)
      this.prisma.attendance.findUnique({
        where: { userId_date: { userId: workerId, date: selected } },
        include: {
          sessions: { orderBy: { checkInTime: 'asc' } },
        },
      }),
    ]);

    // admin side er motoi — sessions theke manually calculate koro
    // attendance.totalHours e open session er time count hoy na
    const sessions = attendanceRecord?.sessions ?? [];
    // Only zone time counts here. Check-in / check-out duration must not affect payroll.
    const totalZoneHours = sessions.reduce(
      (sum, s) => sum + (s.zoneSeconds ?? 0) / 3600,
      0,
    );
    const totalGrossPay = payrolls.reduce((sum, p) => sum + p.grossPay, 0);
    const totalDeductions = payrolls.reduce((sum, p) => sum + p.deductions, 0);
    const totalNetPay = payrolls.reduce((sum, p) => sum + p.netPay, 0);

    // per project breakdown
    const projectBreakdown = payrolls
      .filter((p) => p.project)
      .map((p) => ({
        projectId: p.project!.id,
        projectName: p.project!.name,
        grossPay: Math.round(p.grossPay * 100) / 100,
        netPay: Math.round(p.netPay * 100) / 100,
        regularHours: p.regularHours,
        overtimeHours: p.overtimeHours,
        status: p.status,
      }));

    const transactions = payrolls.map((p) => ({
      id: p.id,
      title: p.project?.name ?? p.company.name,
      company: p.company,
      project: p.project ?? null,
      paidAt: p.processedAt ?? p.createdAt,
      amount: Math.round(p.netPay * 100) / 100,
      status: p.status,
      regularHours: p.regularHours,
      overtimeHours: p.overtimeHours,
      ratePerHour: p.ratePerHour,
      grossPay: Math.round(p.grossPay * 100) / 100,
      deductions: Math.round(p.deductions * 100) / 100,
      netPay: Math.round(p.netPay * 100) / 100,
    }));

    return {
      date: selected,
      summary: {
        totalHours: this.formatHoursAndMinutes(totalZoneHours),
        totalZoneHours: this.formatHoursAndMinutes(totalZoneHours),
        totalGrossPay: Math.round(totalGrossPay * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        totalNetPay: Math.round(totalNetPay * 100) / 100,
        sessionsCount: attendanceRecord?.sessions?.length ?? 0,
      },
      projectBreakdown,
      transactions,
    };
  }

  // ─────────────────────────────────────────────
  // HELPER
  // ─────────────────────────────────────────────

  private pointInPolygon(
  lat: number,
  lng: number,
  coords: { lat: number; lng: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i].lat, yi = coords[i].lng;
    const xj = coords[j].lat, yj = coords[j].lng;
    if (yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
}
