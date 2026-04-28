import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  SubmitTaskReportDto,
  CheckInDto,
  CheckOutDto,
  CreateLeaveRequestDto,
  UpdateProfileDto,
  ChangePasswordDto,
  CreateSupportRequestDto,
  UpdateLocationDto,
} from './dto/worker.dto';

@Injectable()
export class WorkerService {
  constructor(private readonly prisma: PrismaService) { }

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
          assignedTo: workerId,
          OR: [
            { dueDate: { gte: today, lte: todayEnd } },
            { status: 'in_progress' },
            { status: 'pending' },
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
          assignedTo: workerId,
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

    const where: any = {
      assignedTo: workerId,
      ...(status && { status: status as any }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
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
    if (task.assignedTo !== workerId)
      throw new ForbiddenException('This task is not assigned to you');

    return task;
  }

  async startTask(taskId: string, workerId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });

    if (!task) throw new NotFoundException('Task not found');
    if (task.assignedTo !== workerId)
      throw new ForbiddenException('This task is not assigned to you');
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
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });

    if (!task) throw new NotFoundException('Task not found');
    if (task.assignedTo !== workerId)
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
        beforePhotoUrl: dto.beforePhotoUrl ?? null,
        afterPhotoUrl: dto.afterPhotoUrl ?? null,
        receiptUrl: dto.receiptUrl ?? null,
        reviewDecision: 'pending',
      },
    });

    // Task status → review এ পাঠাও
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'review' },
    });

    return {
      message: 'Task report submitted successfully. Waiting for review.',
      report,
    };
  }

  // project এর available inventory items
  async getTaskInventoryItems(taskId: string, workerId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { include: { company: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.assignedTo !== workerId)
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

  async checkIn(workerId: string, dto: CheckInDto) {
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

    // যদি কোনো session এখনো open থাকে (checkout হয়নি) → block
    const openSession = attendance.sessions.find((s) => !s.checkOutTime);
    if (openSession) {
      throw new ConflictException('Already checked in. Please check out first.');
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

    return {
      message: 'Checked in successfully',
      session,
      totalSessionsToday: attendance.sessions.length + 1,
    };
  }

  async checkOut(workerId: string, dto: CheckOutDto) {
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
      throw new ConflictException('No active check-in found. Please check in first.');
    }

    const now = new Date();
    const hoursWorked =
      (now.getTime() - openSession.checkInTime.getTime()) / (1000 * 60 * 60);

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

    // Attendance-এ totalHours recalculate করো
    const allSessions = await this.prisma.attendanceSession.findMany({
      where: { attendanceId: attendance.id },
    });

    const totalHours = allSessions.reduce((sum, s) => sum + (s.hoursWorked ?? 0), 0);

    await this.prisma.attendance.update({
      where: { id: attendance.id },
      data: { totalHours: Math.round(totalHours * 100) / 100 },
    });

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

    return this.prisma.leaveRequest.create({
      data: {
        userId: workerId,
        leaveType: dto.leaveType,
        startDate,
        endDate,
        reason: dto.reason ?? null,
        status: 'pending',
      },
    });
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

  async updateProfile(workerId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: workerId },
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        address: dto.address,
        avatarUrl: dto.avatarUrl,
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
    const log = await this.prisma.locationLog.create({
      data: {
        userId: workerId,
        lat: dto.lat,
        lng: dto.lng,
        geofenceId: dto.geofenceId ?? null,
        eventType: dto.eventType ?? 'update',
      },
    });

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