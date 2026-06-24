import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
  AssignTaskDto,
  ReviewTaskDto,
} from './dto/task.dto';
import { UserRole } from '../../generated/prisma/client';

@Injectable()
export class TaskService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) { }

  private toTaskResponse(task: any) {
    const assignees = task.taskAssignees?.map((assignment: any) => assignment.user) ?? [];
    const normalizedAssignees = assignees.length > 0 ? assignees : (task.assignee ? [task.assignee] : []);

    return {
      ...task,
      assignees: normalizedAssignees,
      available: normalizedAssignees.length === 0,
    };
  }

  // ── GET ALL TASKS ──────────────────────────────────────────────
  async getTasks(
    userId: string,
    userRole: string,
    status?: string,
    search?: string,
    projectId?: string,
    page = 1,
    limit = 10,
  ) {
    let projectIds: string[];

    if (userRole === UserRole.manager) {
      // Manager → শুধু assigned project-এর tasks
      const assignedProjects = await this.prisma.projectMember.findMany({
        where: { userId, role: 'manager' },
        select: { projectId: true },
      });
      projectIds = assignedProjects.map((p) => p.projectId);
    } else {
      // Admin → company ownership দিয়ে
      const myCompanies = await this.prisma.company.findMany({
        where: { ownerId: userId, isActive: true },
        select: { id: true },
      });
      const companyIds = myCompanies.map((c) => c.id);
      const myProjects = await this.prisma.project.findMany({
        where: { companyId: { in: companyIds } },
        select: { id: true },
      });
      projectIds = myProjects.map((p) => p.id);
    }

    const skip = (page - 1) * limit;

    const where: any = {
      projectId: { in: projectIds },
      ...(projectId && { projectId }),
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
          assignee: {
            select: { id: true, fullName: true, avatarUrl: true, role: true },
          },
          taskAssignees: {
            include: {
              user: {
                select: { id: true, fullName: true, avatarUrl: true, role: true },
              },
            },
          },
          _count: { select: { reports: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    const mapped = data.map((t) => this.toTaskResponse(t));

    return {
      data: mapped,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── CREATE TASK ────────────────────────────────────────────────
  async createTask(dto: CreateTaskDto, userId: string, userRole: string) {
    // project access verify
    let project;
    if (userRole === UserRole.manager) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: dto.projectId, userId, role: 'manager' },
      });
      if (!member) throw new ForbiddenException('You are not assigned to this project');
      project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    } else {
      project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, company: { ownerId: userId } },
      });
    }
    if (!project) throw new ForbiddenException('Project not found or not yours');

    // floor/room validate
    if (dto.floorId) {
      const floor = await this.prisma.floor.findFirst({
        where: { id: dto.floorId, projectId: dto.projectId },
      });
      if (!floor) throw new NotFoundException('Floor not found in this project');
    }

    if (dto.roomId) {
      const room = await this.prisma.room.findFirst({
        where: { id: dto.roomId, floor: { projectId: dto.projectId } },
      });
      if (!room) throw new NotFoundException('Room not found in this project');
    }



    const task = await this.prisma.task.create({
      data: {
        projectId: dto.projectId,
        floorId: dto.floorId ?? null,
        roomId: dto.roomId ?? null,
        assignedTo: null,
        createdBy: userId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? 'medium',
        status: 'pending',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        estimatedHours: dto.estimatedHours ?? null,
      },
      include: {
        project: { select: { id: true, name: true } },
        floor: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
        assignee: { select: { id: true, fullName: true, avatarUrl: true } },
        taskAssignees: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
      },
    });

    return this.toTaskResponse(task);
  }

  // ── GET TASK DETAILS ───────────────────────────────────────────
  async getTaskDetails(taskId: string, userId: string, userRole: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: { id: true, name: true, company: { select: { ownerId: true } } },
        },
        floor: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            role: true,
            department: true,
          },
        },
        creator: { select: { id: true, fullName: true, avatarUrl: true } },
        taskAssignees: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          },
        },
        reports: {
          orderBy: { submittedAt: 'desc' },
          include: {
            worker: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
        taskInventories: {
          include: {
            inventory: { select: { id: true, name: true, unit: true } },
          },
        },
      },
    });

    if (!task) throw new NotFoundException('Task not found');
    if (userRole === UserRole.manager) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: task.projectId, userId, role: 'manager' },
      });
      if (!member) throw new ForbiddenException('Access denied');
    } else {
      if (task.project.company.ownerId !== userId)
        throw new ForbiddenException('Access denied');
    }

    // task expenses
    const expenses = await this.prisma.expense.findMany({
      where: {
        OR: [
          { taskId: task.id },
          { projectId: task.projectId, taskId: null },
        ],
      },
      select: {
        id: true,
        description: true,
        category: true,
        amount: true,
        status: true,
        date: true,
        taskId: true,
        worker: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { ...this.toTaskResponse(task), expenses };
  }

  // ── UPDATE TASK ────────────────────────────────────────────────
  async updateTask(
    taskId: string,
    dto: UpdateTaskDto,
    userId: string,
    userRole: string,
    file?: Express.Multer.File,
  ) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });

    let createdExpense: any = null;
    const expenseDescription = dto.expenseDescription?.trim() || dto.description?.trim();
    const hasExpensePayload = Boolean(expenseDescription || file?.filename);
    if (hasExpensePayload) {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { projectId: true },
      });

      if (task) {
        createdExpense = await this.prisma.expense.create({
          data: {
            workerId: userId,
            projectId: task.projectId,
            taskId,
            description: expenseDescription || 'Task expense',
            category: 'other',
            amount: dto.expenseAmount ?? 0,
            receiptUrl: file?.filename ?? null,
            date: new Date(),
            status: 'pending',
          },
          select: {
            id: true,
            description: true,
            category: true,
            amount: true,
            receiptUrl: true,
            status: true,
            date: true,
            taskId: true,
          },
        });
      }
    }

    return {
      ...updatedTask,
      ...(createdExpense ? { expense: createdExpense } : {}),
    };
  }

  // ── UPDATE STATUS ──────────────────────────────────────────────
  async updateTaskStatus(taskId: string, dto: UpdateTaskStatusDto, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: dto.status },
    });
  }

  // ── DELETE TASK ────────────────────────────────────────────────
  async deleteTask(taskId: string, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);
    await this.prisma.task.delete({ where: { id: taskId } });
    return { message: 'Task deleted successfully' };
  }

  // ── AVAILABLE WORKERS TO ASSIGN ────────────────────────────────
  async getAvailableWorkers(taskId: string, userId: string, userRole: string, search?: string) {
    const task = await this.verifyTaskAccess(taskId, userId, userRole);

    // এই project এর worker members
    const members = await this.prisma.projectMember.findMany({
      where: { projectId: task.projectId, role: 'worker' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
            department: true,
            status: true,
          },
        },
      },
    });


    const totalWorkers = members.length;

    const assignedIds = new Set([
      task.assignedTo,
      ...(task.taskAssignees?.map((assignment) => assignment.userId) ?? []),
    ].filter((value): value is string => Boolean(value)));

    let workers = members.map((m) => {
      const isAssigned = assignedIds.has(m.user.id);
      return {
        ...m.user,
        memberId: m.id,
        isAssigned,
        // not available if assigned to this task or user is not active
        isAvailable: !isAssigned && m.user.status === 'active',
      };
    });

    if (search) {
      const s = search.toLowerCase();
      workers = workers.filter((w) => w.fullName.toLowerCase().includes(s));
    }

    const availableCount = workers.filter((w) => w.isAvailable).length;

    return {
      data: workers,
      meta: { totalWorkers, availableCount },
    };
  }

  // ── ASSIGN WORKER ──────────────────────────────────────────────
  async assignWorker(taskId: string, dto: AssignTaskDto, userId: string, userRole: string) {
    const task = await this.verifyTaskAccess(taskId, userId, userRole);
    const userIds = [...new Set(dto.userIds)];

    if (userIds.length === 0) {
      throw new BadRequestException('At least one worker is required');
    }

    const members = await this.prisma.projectMember.findMany({
      where: { projectId: task.projectId, userId: { in: userIds } },
      select: { userId: true },
    });

    if (members.length !== userIds.length) {
      throw new BadRequestException('One or more users are not members of this project');
    }

    const existingAssignees = await this.prisma.taskAssignee.findMany({
      where: { taskId, userId: { in: userIds } },
      select: { userId: true },
    });

    const existingAssigneeIds = new Set(existingAssignees.map((assignment) => assignment.userId));
    const newAssigneeIds = userIds.filter((workerId) => !existingAssigneeIds.has(workerId));

    if (newAssigneeIds.length > 0) {
      await this.prisma.taskAssignee.createMany({
        data: newAssigneeIds.map((workerId) => ({ taskId, userId: workerId })),
        skipDuplicates: true,
      });
    }

    if (!task.assignedTo) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          assignedTo: userIds[0],
          status: 'in_progress',
        },
      });
    } else if (task.status === 'pending') {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'in_progress' },
      });
    }

    const updated = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
        taskAssignees: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          },
        },
        project: { select: { id: true, name: true } },
      },
    });

    if (!updated) throw new NotFoundException('Task not found');

    // Notify each assigned worker
    for (const workerId of newAssigneeIds) {
      await this.notificationsService.send({
        userId: workerId,
        title: 'New Task Assigned',
        body: `You have been assigned to task: ${task.title}`,
        type: 'task',
        refId: taskId,
        refType: 'task',
      });
    }

    return this.toTaskResponse(updated);
  }

  // ── REVIEW TASK REPORT ─────────────────────────────────────────
  async reviewTaskReport(taskId: string, reportId: string, dto: ReviewTaskDto, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    const report = await this.prisma.taskReport.findFirst({
      where: { id: reportId, taskId },
    });
    if (!report) throw new NotFoundException('Report not found');

    const updated = await this.prisma.taskReport.update({
      where: { id: reportId },
      data: {
        reviewDecision: dto.reviewDecision as any,
        reviewDescription: dto.reviewDescription ?? null,
        reviewedBy: userId,
        reviewedAt: new Date(),
      },
    });

    // Notify worker about review result
    await this.notificationsService.send({
      userId: report.workerId,
      title: dto.reviewDecision === 'approved' ? 'Task Report Approved ✓' : 'Task Report Rejected',
      body: dto.reviewDescription ?? (dto.reviewDecision === 'approved' ? 'Your task report has been approved.' : 'Your task report was rejected.'),
      type: 'report',
      refId: reportId,
      refType: 'task_report',
    });

    if (dto.reviewDecision === 'approved') {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'completed' },
      });
    }

    return { message: `Task ${dto.reviewDecision}`, report: updated };
  }

  // ── HELPER ────────────────────────────────────────────────────
  private async verifyTaskAccess(taskId: string, userId: string, userRole?: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: { include: { company: true } },
        taskAssignees: { select: { userId: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');

    if (userRole === UserRole.manager) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: task.projectId, userId, role: 'manager' },
      });
      if (!member) throw new ForbiddenException('Access denied');
    } else {
      if (task.project.company.ownerId !== userId)
        throw new ForbiddenException('Access denied');
    }
    return task;
  }
}
