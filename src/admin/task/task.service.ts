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
  CreateSubTaskDto,
} from './dto/task.dto';
import { UserRole, TaskPriority } from '../../generated/prisma/client';

type AuthUser = {
  id: string;
  role: string;
  companyId?: string;
};

type PaginationInput = {
  page?: number | string;
  limit?: number | string;
};

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private normalizePagination(query: PaginationInput) {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limit = Math.max(1, Number(query.limit ?? 10) || 10);
    return { page, limit, skip: (page - 1) * limit };
  }

  private async getProjectIdsForUser(userId: string, userRole: string) {
    if (userRole === UserRole.super_admin) {
      const projects = await this.prisma.project.findMany({ select: { id: true } });
      return projects.map((project) => project.id);
    }

    if (userRole === UserRole.admin) {
      const companies = await this.prisma.company.findMany({
        where: { ownerId: userId, isActive: true },
        select: { id: true },
      });

      const companyIds = companies.map((company) => company.id);
      const projects = await this.prisma.project.findMany({
        where: { companyId: { in: companyIds } },
        select: { id: true },
      });
      return projects.map((project) => project.id);
    }

    const memberships = await this.prisma.projectMember.findMany({
      where: { userId, role: 'manager' },
      select: { projectId: true },
    });

    return memberships.map((membership) => membership.projectId);
  }

  private async verifyTaskAccess(taskId: string, userId: string, userRole: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { include: { company: true } } },
    });

    if (!task) throw new NotFoundException('Task not found');

    if (userRole === UserRole.super_admin) {
      return task;
    }

    if (userRole === UserRole.manager) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: task.projectId, userId, role: 'manager' },
      });
      if (!member) throw new ForbiddenException('Access denied');
      return task;
    }

    if (task.project.company.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return task;
  }

  private async ensureProjectAndTaskUnits(taskId: string, unitId: string) {
    const taskUnit = await this.prisma.taskUnit.findFirst({
      where: { taskId, unitId: unitId },
      include: { unit: { select: { id: true, name: true } } },
    });

    if (!taskUnit) {
      throw new NotFoundException('Unit not found in this task');
    }

    return taskUnit;
  }

  private async resolveTaskAssignee(taskId: string, unitId: string, userId?: string) {
    if (userId) {
      const assignee = await this.prisma.taskAssignee.findFirst({
        where: { taskId, unitId: unitId, userId },
        include: {
          user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          unit: { select: { id: true, name: true } },
        },
      });

      if (assignee) return assignee;
    }

    const firstAssignee = await this.prisma.taskAssignee.findFirst({
      where: { taskId, unitId: unitId },
      orderBy: { assignedAt: 'asc' },
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
        unit: { select: { id: true, name: true } },
      },
    });

    if (!firstAssignee) {
      throw new BadRequestException('No worker assigned for this unit');
    }

    return firstAssignee;
  }

  private async refreshTaskProgress(taskId: string) {
    const [subTaskCount, completedCount] = await Promise.all([
      this.prisma.subTask.count({ where: { taskId } }),
      this.prisma.subTask.count({
        where: { taskId, status: 'completed', approvalDecision: 'approved' },
      }),
    ]);

    if (subTaskCount === 0) {
      return;
    }

    if (subTaskCount === completedCount) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'review' },
      });
      return;
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'in_progress' },
    });
  }

  private buildTaskLocations(task: any) {
    const floorMap = new Map<
      string,
      { id: string; name: string; floorNumber: number; units: Array<{ id: string; name: string }> }
    >();

    for (const entry of task.taskFloors ?? []) {
      if (!entry.floor) continue;
      if (!floorMap.has(entry.floor.id)) {
        floorMap.set(entry.floor.id, {
          id: entry.floor.id,
          name: entry.floor.name,
          floorNumber: entry.floor.floorNumber,
          units: [],
        });
      }
    }

    for (const entry of task.taskUnits ?? []) {
      if (!entry.unit) continue;
      const floorId = entry.unit.floor?.id ?? entry.unit.floorId ?? task.floorId ?? null;
      const floorName = entry.unit.floor?.name ?? null;
      const floorNumber = entry.unit.floor?.floorNumber ?? 0;

      if (!floorId) continue;

      if (!floorMap.has(floorId)) {
        floorMap.set(floorId, {
          id: floorId,
          name: floorName ?? 'Floor',
          floorNumber,
          units: [],
        });
      }

      const floor = floorMap.get(floorId)!;
      if (!floor.units.some((unit) => unit.id === entry.unit.id)) {
        floor.units.push({ id: entry.unit.id, name: entry.unit.name });
      }
    }

    return Array.from(floorMap.values());
  }

  private buildTaskLocationLabel(task: any) {
    const locations = this.buildTaskLocations(task);
    if (locations.length === 0) {
      return null;
    }

    return locations
      .map((floor) => {
        const unitNames = floor.units.map((unit) => unit.name);
        return unitNames.length > 0 ? `${floor.name} - ${unitNames.join(', ')}` : floor.name;
      })
      .join('; ');
  }

  private countAssignedWorkers(task: any) {
    const uniqueWorkerIds = new Set(
      (task.taskAssignees ?? [])
        .map((assignee: any) => assignee?.user?.id ?? assignee?.userId ?? null)
        .filter(Boolean),
    );

    return uniqueWorkerIds.size;
  }

  private toTaskResponse(task: any) {
    const { taskFloors, taskUnits, taskAssignees, subTasks, _count, project, floor, unit, ...rest } = task;
    const subTaskCount = _count?.subTasks ?? subTasks?.length ?? 0;
    const completedSubTaskCount =
      subTasks?.filter((subTask: any) => subTask.status === 'completed').length ?? 0;
    const assignedWorkerCount = this.countAssignedWorkers(task);

    return {
      project: project ? { id: project.id, name: project.name } : null,
      task: {
        id: rest.id,
        title: rest.title,
        description: rest.description,
        priority: rest.priority,
        status: rest.status,
        approvalDecision: rest.approvalDecision,
        approvalNotes: rest.approvalNotes,
        completionDecision: rest.completionDecision,
        completionNotes: rest.completionNotes,
        dueDate: rest.dueDate,
      },
      floors: this.buildTaskLocations(task),
      location: this.buildTaskLocationLabel(task),
      subTaskCount,
      completedSubTaskCount,
      assignedWorkerCount,
    };
  }

  private toTaskWithSubTasksResponse(task: any) {
    const base = this.toTaskResponse(task);
    return {
      ...base,
      subTasks: (task.subTasks ?? []).map((subTask: any) => ({
        id: subTask.id,
        title: subTask.title,
        description: subTask.description,
        priority: subTask.priority,
        dueDate: subTask.dueDate,
        status: subTask.status,
        approvalDecision: subTask.approvalDecision,
        approvalNotes: subTask.approvalNotes,
        startedAt: subTask.startedAt,
        submittedAt: subTask.submittedAt,
        completedAt: subTask.completedAt,
        unit: subTask.unit ?? null,
        units: (subTask.subTaskUnits ?? []).map((item: any) => item.unit),
      })),
    };
  }

  async getTasks(
    userId: string,
    userRole: string,
    status?: string,
    search?: string,
    projectId?: string,
    page = 1,
    limit = 10,
  ) {
    const projectIds = await this.getProjectIdsForUser(userId, userRole);
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
          floor: { select: { id: true, name: true, floorNumber: true } },
          unit: { select: { id: true, name: true } },
          taskFloors: {
            include: { floor: { select: { id: true, name: true, floorNumber: true } } },
          },
          taskUnits: {
            include: {
              unit: {
                select: {
                  id: true,
                  name: true,
                  floorId: true,
                  floor: { select: { id: true, name: true, floorNumber: true } },
                },
              },
            },
          },
          taskAssignees: {
            include: {
              user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
              unit: { select: { id: true, name: true } },
            },
          },
          subTasks: {
            orderBy: { createdAt: 'desc' },
            include: {
              unit: { select: { id: true, name: true } },
              taskAssignee: {
                include: {
                  user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
                  unit: { select: { id: true, name: true } },
                },
              },
            },
          },
          _count: { select: { subTasks: true, reports: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data: data.map((task) => this.toTaskResponse(task)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async createTask(dto: CreateTaskDto, userId: string, userRole: string) {
    const canCreateAsAdmin = userRole === UserRole.admin || userRole === UserRole.super_admin;
    const canCreateAsManager = userRole === UserRole.manager;

    if (!canCreateAsAdmin && !canCreateAsManager) {
      throw new ForbiddenException('You are not allowed to create tasks');
    }

    if (userRole === UserRole.manager) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: dto.projectId, userId, role: 'manager' },
      });
      if (!member) {
        throw new ForbiddenException('You are not assigned to this project');
      }
    } else {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, company: { ownerId: userId } },
      });
      if (!project) {
        throw new ForbiddenException('Project not found or not yours');
      }
    }

    const nestedFloorIds = dto.floors?.map((item) => item.floorId) ?? [];
    const nestedUnitIds = dto.floors?.flatMap((item) => item.unitIds ?? []) ?? [];
    const floorIds = Array.from(new Set([...(dto.floorIds ?? []), ...nestedFloorIds]));
    const unitIds = Array.from(new Set([...(dto.unitIds ?? []), ...nestedUnitIds]));

    if (dto.floorId) {
      const floor = await this.prisma.floor.findFirst({
        where: { id: dto.floorId, projectId: dto.projectId },
      });
      if (!floor) throw new NotFoundException('Floor not found in this project');
    }

    if (dto.unitId) {
      const room = await this.prisma.unit.findFirst({
        where: { id: dto.unitId, floor: { projectId: dto.projectId } },
      });
      if (!room) throw new NotFoundException('Unit not found in this project');
    }

    if (floorIds.length) {
      const floors = await this.prisma.floor.findMany({
        where: { id: { in: floorIds }, projectId: dto.projectId },
        select: { id: true },
      });
      if (floors.length !== floorIds.length) {
        throw new NotFoundException('One or more floors not found in this project');
      }
    }

    if (unitIds.length) {
      const units = await this.prisma.unit.findMany({
        where: { id: { in: unitIds }, floor: { projectId: dto.projectId } },
        select: { id: true },
      });
      if (units.length !== unitIds.length) {
        throw new NotFoundException('One or more units not found in this project');
      }
    }

    const approvalDecision = userRole === UserRole.manager ? 'pending' : 'approved';

    const task = await this.prisma.task.create({
      data: {
        projectId: dto.projectId,
        floorId: dto.floors?.length ? null : dto.floorId ?? null,
        unitId: dto.floors?.length ? null : dto.unitId ?? null,
        assignedTo: null,
        createdBy: userId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? TaskPriority.medium,
        status: 'pending',
        approvalDecision,
        approvalReviewedBy: approvalDecision === 'approved' ? userId : null,
        approvalReviewedAt: approvalDecision === 'approved' ? new Date() : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        estimatedHours: dto.estimatedHours ?? null,
      },
    });

    if (floorIds.length) {
      await this.prisma.taskFloor.createMany({
        data: floorIds.map((floorId) => ({ taskId: task.id, floorId })),
        skipDuplicates: true,
      });
    } else if (dto.floorId) {
      await this.prisma.taskFloor.createMany({
        data: [{ taskId: task.id, floorId: dto.floorId }],
        skipDuplicates: true,
      });
    }

    if (unitIds.length) {
      await this.prisma.taskUnit.createMany({
        data: unitIds.map((unitId) => ({ taskId: task.id, unitId })),
        skipDuplicates: true,
      });
    } else if (dto.unitId) {
      await this.prisma.taskUnit.createMany({
        data: [{ taskId: task.id, unitId: dto.unitId }],
        skipDuplicates: true,
      });
    }

    const created = await this.prisma.task.findUnique({
      where: { id: task.id },
      include: {
        project: { select: { id: true, name: true } },
        floor: { select: { id: true, name: true, floorNumber: true } },
        unit: { select: { id: true, name: true } },
        taskFloors: {
          include: { floor: { select: { id: true, name: true, floorNumber: true } } },
        },
        taskUnits: {
          include: {
            unit: {
              select: {
                id: true,
                name: true,
                floorId: true,
                floor: { select: { id: true, name: true, floorNumber: true } },
              },
            },
          },
        },
        taskAssignees: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        subTasks: true,
      },
    });

    return this.toTaskResponse(created);
  }

  async getTaskDetails(taskId: string, userId: string, userRole: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: { id: true, name: true, company: { select: { ownerId: true } } },
        },
        floor: { select: { id: true, name: true, floorNumber: true } },
        unit: { select: { id: true, name: true } },
        creator: { select: { id: true, fullName: true, avatarUrl: true } },
        taskAssignees: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        taskFloors: {
          include: { floor: { select: { id: true, name: true, floorNumber: true } } },
        },
        taskUnits: {
          include: {
            unit: {
              select: {
                id: true,
                name: true,
                floorId: true,
                floor: { select: { id: true, name: true, floorNumber: true } },
              },
            },
          },
        },
        subTasks: {
          orderBy: { createdAt: 'desc' },
          include: {
            unit: { select: { id: true, name: true } },
            taskAssignee: {
              include: {
                user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
                unit: { select: { id: true, name: true } },
              },
            },
            reports: {
              orderBy: { submittedAt: 'desc' },
              include: { worker: { select: { id: true, fullName: true, avatarUrl: true } } },
            },
            inventories: {
              include: {
                inventory: { select: { id: true, name: true, unit: true } },
              },
            },
          },
        },
        reports: {
          orderBy: { submittedAt: 'desc' },
          include: {
            worker: { select: { id: true, fullName: true, avatarUrl: true } },
            subTask: { select: { id: true, title: true } },
          },
        },
        taskInventories: {
          include: {
            inventory: { select: { id: true, name: true, unit: true } },
            subTask: { select: { id: true, title: true } },
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
    } else if (userRole !== UserRole.super_admin) {
      if (task.project.company.ownerId !== userId) {
        throw new ForbiddenException('Access denied');
      }
    }

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
        receiptUrl: true,
        taskId: true,
        worker: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...this.toTaskResponse(task),
      expenses: expenses.map((expense) => ({
        id: expense.id,
        description: expense.description,
        category: expense.category,
        amount: expense.amount,
        status: expense.status,
        date: expense.date,
        receiptUrl: expense.receiptUrl,
        taskId: expense.taskId,
        reporter: expense.worker,
      })),
    };
  }

  async getTaskLocations(taskId: string, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        taskFloors: {
          include: { floor: { select: { id: true, name: true } } },
        },
        taskUnits: {
          include: {
            unit: {
              select: {
                id: true,
                name: true,
                floorId: true,
                floor: { select: { id: true, name: true, floorNumber: true } },
              },
            },
          },
        },
      },
    });

    if (!task) throw new NotFoundException('Task not found');

    const floors = Array.from(
      new Map(
        task.taskFloors
          .filter((entry) => entry.floor)
          .map((entry) => [entry.floor.id, { id: entry.floor.id, name: entry.floor.name }]),
      ).values(),
    );

    const units = Array.from(
      new Map(
        task.taskUnits
          .filter((entry) => entry.unit)
          .map((entry) => [entry.unit.id, { id: entry.unit.id, name: entry.unit.name }]),
      ).values(),
    );

    return { floors, units };
  }

  async getSubTasks(taskId: string, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    const subTasks = await this.prisma.subTask.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: {
        unit: { select: { id: true, name: true } },
        subTaskUnits: {
          include: {
            unit: { select: { id: true, name: true } },
          },
        },
        task: {
          select: {
            id: true,
            title: true,
            priority: true,
            dueDate: true,
            status: true,
            approvalDecision: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
    });

    return {
      data: subTasks.map((subTask: any) => ({
        id: subTask.id,
        title: subTask.title,
        description: subTask.description,
        priority: subTask.priority,
        dueDate: subTask.dueDate,
        status: subTask.status,
        approvalDecision: subTask.approvalDecision,
        task: subTask.task,
        units: (subTask.subTaskUnits ?? []).map((item: any) => item.unit),
      })),
    };
  }

  async getSubTaskDetails(taskId: string, subTaskId: string, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    const subTask = await this.prisma.subTask.findFirst({
      where: { id: subTaskId, taskId },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            priority: true,
            dueDate: true,
            status: true,
            approvalDecision: true,
            project: { select: { id: true, name: true } },
          },
        },
        unit: { select: { id: true, name: true, type: true } },
        subTaskUnits: {
          include: {
            unit: { select: { id: true, name: true } },
          },
        },
        creator: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
        taskAssignee: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        reports: {
          orderBy: { submittedAt: 'desc' },
          include: { worker: { select: { id: true, fullName: true, avatarUrl: true } } },
        },
        inventories: {
          include: {
            inventory: { select: { id: true, name: true, unit: true } },
          },
        },
      },
    });

    if (!subTask) {
      throw new NotFoundException('Sub task not found');
    }

    return subTask;
  }

  async getAllSubTasks(
    userId: string,
    userRole: string,
    query: {
      taskId?: string;
      projectId?: string;
      unitId?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limit = Math.max(1, Number(query.limit ?? 10) || 10);
    const skip = (page - 1) * limit;

    const projectIds = await this.getProjectIdsForUser(userId, userRole);
    const where: any = {
      task: {
        projectId: { in: projectIds },
        ...(query.projectId && { projectId: query.projectId }),
      },
      ...(query.taskId && { taskId: query.taskId }),
      ...(query.unitId && { unitId: query.unitId }),
      ...(query.status && { status: query.status }),
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.subTask.findMany({
        where,
        include: {
          task: {
            select: {
              id: true,
              title: true,
              priority: true,
              dueDate: true,
              status: true,
              approvalDecision: true,
              project: { select: { id: true, name: true } },
            },
          },
          unit: { select: { id: true, name: true } },
          subTaskUnits: {
            include: {
              unit: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.subTask.count({ where }),
    ]);

    return {
      data: data.map((subTask: any) => ({
        id: subTask.id,
        title: subTask.title,
        description: subTask.description,
        priority: subTask.priority,
        dueDate: subTask.dueDate,
        status: subTask.status,
        approvalDecision: subTask.approvalDecision,
        task: subTask.task,
        units: (subTask.subTaskUnits ?? []).map((item: any) => item.unit),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAdminSubTaskDetails(userId: string, userRole: string, subTaskId: string) {
    const projectIds = await this.getProjectIdsForUser(userId, userRole);

    const subTask = await this.prisma.subTask.findFirst({
      where: {
        id: subTaskId,
        task: { projectId: { in: projectIds } },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            description: true,
            priority: true,
            dueDate: true,
            status: true,
            approvalDecision: true,
            completionDecision: true,
            project: { select: { id: true, name: true } },
          },
        },
        unit: { select: { id: true, name: true, type: true } },
        subTaskUnits: {
          include: {
            unit: { select: { id: true, name: true } },
          },
        },
        creator: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
        taskAssignee: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        reports: {
          orderBy: { submittedAt: 'desc' },
          include: {
            worker: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
        inventories: {
          include: {
            inventory: { select: { id: true, name: true, unit: true } },
          },
        },
      },
    });

    if (!subTask) {
      throw new NotFoundException('Sub task not found');
    }

    return subTask;
  }

  async updateTask(
    taskId: string,
    dto: UpdateTaskDto,
    userId: string,
    userRole: string,
    file?: Express.Multer.File,
  ) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    const { floorIds, unitIds, expenseDescription, expenseAmount, ...taskUpdates } =
      dto as UpdateTaskDto & {
        floorIds?: string[];
        unitIds?: string[];
        expenseDescription?: string;
        expenseAmount?: number | string;
      };

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...taskUpdates,
        dueDate: taskUpdates.dueDate ? new Date(taskUpdates.dueDate) : undefined,
      },
    });

    if (floorIds !== undefined) {
      await this.prisma.taskFloor.deleteMany({ where: { taskId } });
      if (floorIds.length > 0) {
        const floors = await this.prisma.floor.findMany({
          where: { id: { in: floorIds }, projectId: updatedTask.projectId },
          select: { id: true },
        });
        if (floors.length !== floorIds.length) {
          throw new NotFoundException('One or more floors not found in this project');
        }
        await this.prisma.taskFloor.createMany({
          data: floorIds.map((floorId) => ({ taskId, floorId })),
          skipDuplicates: true,
        });
      }
    }

    if (unitIds !== undefined) {
      await this.prisma.taskUnit.deleteMany({ where: { taskId } });
      if (unitIds.length > 0) {
        const units = await this.prisma.unit.findMany({
          where: { id: { in: unitIds }, floor: { projectId: updatedTask.projectId } },
          select: { id: true },
        });
        if (units.length !== unitIds.length) {
          throw new NotFoundException('One or more units not found in this project');
        }
        await this.prisma.taskUnit.createMany({
          data: unitIds.map((unitId) => ({ taskId, unitId })),
          skipDuplicates: true,
        });
      }
    }

    if (expenseDescription || expenseAmount !== undefined || file?.filename) {
      const normalizedAmount =
        expenseAmount === undefined || expenseAmount === null
          ? 0
          : Number(expenseAmount);

      await this.prisma.expense.create({
        data: {
          workerId: userId,
          projectId: updatedTask.projectId,
          taskId,
          description: expenseDescription?.trim() || 'Task expense',
          category: 'other',
          amount: Number.isFinite(normalizedAmount) ? normalizedAmount : 0,
          receiptUrl: file?.filename ?? null,
          date: new Date(),
          status: 'pending',
        },
      });
    }

    return updatedTask;
  }

  async updateTaskStatus(taskId: string, dto: UpdateTaskStatusDto, userId: string, userRole: string) {
    const task = await this.verifyTaskAccess(taskId, userId, userRole);

    if (task.approvalDecision !== 'approved' && dto.status !== 'cancelled') {
      throw new BadRequestException('Approved task only can move to execution flow');
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: dto.status as any },
    });
  }

  async reviewTaskApproval(taskId: string, dto: ReviewTaskDto, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);
    if (userRole !== UserRole.admin && userRole !== UserRole.super_admin) {
      throw new ForbiddenException('Only admin can approve or reject the task');
    }

    if (dto.reviewDecision === 'approved') {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          approvalDecision: 'approved',
          approvalReviewedBy: userId,
          approvalReviewedAt: new Date(),
          approvalNotes: dto.reviewDescription ?? null,
          status: 'pending',
        },
      });
      return { message: 'Task approved' };
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        approvalDecision: 'rejected',
        approvalReviewedBy: userId,
        approvalReviewedAt: new Date(),
        approvalNotes: dto.reviewDescription ?? null,
        status: 'cancelled',
      },
    });
    return { message: 'Task rejected' };
  }

  async deleteTask(taskId: string, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);
    await this.prisma.task.delete({ where: { id: taskId } });
    return { message: 'Task deleted successfully' };
  }

  async getAvailableWorkers(
    taskId: string,
    userId: string,
    userRole: string,
    search?: string,
    unitId?: string,
  ) {
    const task = await this.verifyTaskAccess(taskId, userId, userRole);
    const projectMembers = await this.prisma.projectMember.findMany({
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

    const assigned = await this.prisma.taskAssignee.findMany({
      where: {
        taskId,
        ...(unitId ? { unitId: unitId } : {}),
      },
      select: { userId: true, unitId: true },
    });

    const assignedIds = new Set(assigned.map((entry) => entry.userId));
    let workers = projectMembers.map((member) => {
      const isAssigned = assignedIds.has(member.user.id);
      return {
        ...member.user,
        memberId: member.id,
        isAssigned,
        isAvailable: !isAssigned && member.user.status === 'active',
      };
    });

    if (search) {
      const needle = search.toLowerCase();
      workers = workers.filter((worker) => worker.fullName.toLowerCase().includes(needle));
    }

    return {
      data: workers,
      meta: {
        totalWorkers: workers.length,
        availableCount: workers.filter((worker) => worker.isAvailable).length,
      },
    };
  }

  async assignWorker(taskId: string, dto: AssignTaskDto, userId: string, userRole: string) {
    if (userRole !== UserRole.admin && userRole !== UserRole.super_admin) {
      throw new ForbiddenException('Only admin can assign workers');
    }

    const task = await this.verifyTaskAccess(taskId, userId, userRole);
    if (task.approvalDecision !== 'approved') {
      throw new BadRequestException('Task must be approved before assigning workers');
    }

    const unitIds = [...new Set(dto.unitIds)];
    if (unitIds.length === 0) {
      throw new BadRequestException('At least one unit is required');
    }

    const units = await this.prisma.taskUnit.findMany({
      where: { taskId, unitId: { in: unitIds } },
      include: { unit: { select: { id: true, name: true } } },
    });
    if (units.length !== unitIds.length) {
      throw new NotFoundException('One or more units not found in this task');
    }

    const uniqueUserIds = [...new Set(dto.userIds)];
    if (uniqueUserIds.length === 0) {
      throw new BadRequestException('At least one worker is required');
    }

    const members = await this.prisma.projectMember.findMany({
      where: { projectId: task.projectId, userId: { in: uniqueUserIds }, role: 'worker' },
      select: { userId: true },
    });

    if (members.length !== uniqueUserIds.length) {
      throw new BadRequestException('One or more users are not members of this project');
    }

    const existing = await this.prisma.taskAssignee.findMany({
      where: { taskId, unitId: { in: unitIds }, userId: { in: uniqueUserIds } },
      select: { userId: true, unitId: true },
    });

    const existingKeys = new Set(existing.map((item) => `${item.unitId}:${item.userId}`));
    const data = unitIds.flatMap((unitId) =>
      uniqueUserIds
        .filter((workerId) => !existingKeys.has(`${unitId}:${workerId}`))
        .map((workerId) => ({
          taskId,
          userId: workerId,
          unitId: unitId,
        })),
    );

    if (data.length > 0) {
      await this.prisma.taskAssignee.createMany({
        data,
        skipDuplicates: true,
      });
    }

    const updated = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: { select: { id: true, name: true } },
        taskAssignees: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        taskFloors: {
          include: { floor: { select: { id: true, name: true, floorNumber: true } } },
        },
        taskUnits: {
          include: {
            unit: {
              select: {
                id: true,
                name: true,
                floorId: true,
                floor: { select: { id: true, name: true, floorNumber: true } },
              },
            },
          },
        },
      },
    });

    if (!updated) throw new NotFoundException('Task not found');

    const notifiedWorkerIds = [...new Set(data.map((item) => item.userId))];
    for (const workerId of notifiedWorkerIds) {
      await this.notificationsService.send({
        userId: workerId,
        title: 'New Unit Assigned',
        body: `You have been assigned to a unit on task: ${task.title}`,
        type: 'task',
        refId: taskId,
        refType: 'task',
      });
    }

    return this.toTaskResponse(updated);
  }

  async createSubTask(taskId: string, dto: CreateSubTaskDto, userId: string, userRole: string) {
    const task = await this.verifyTaskAccess(taskId, userId, userRole);
    if (task.approvalDecision !== 'approved') {
      throw new BadRequestException('Task must be approved before creating subtasks');
    }

    const unitIds = Array.from(new Set([...(dto.unitIds ?? []), ...(dto.unitId ? [dto.unitId] : [])]));
    if (unitIds.length === 0) {
      throw new BadRequestException('unitId or unitIds is required');
    }

    const approvalDecision = userRole === UserRole.worker ? 'pending' : 'approved';
    const taskUnits = await this.prisma.taskUnit.findMany({
      where: { taskId, unitId: { in: unitIds } },
      include: {
        unit: { select: { id: true, name: true } },
      },
    });

    if (taskUnits.length !== unitIds.length) {
      throw new NotFoundException('One or more units not found in this task');
    }

    const primaryUnitId = unitIds[0];
    const primaryTaskUnit = taskUnits.find((item) => item.unitId === primaryUnitId);
    if (!primaryTaskUnit) {
      throw new NotFoundException('Unit not found in this task');
    }

    let taskAssignee: any = null;

    if (userRole === UserRole.worker) {
      taskAssignee = await this.resolveTaskAssignee(taskId, primaryUnitId, userId);
    } else if (!taskAssignee) {
      taskAssignee = await this.prisma.taskAssignee.findFirst({
        where: { taskId, unitId: primaryUnitId },
        include: {
          user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          unit: { select: { id: true, name: true } },
        },
        orderBy: { assignedAt: 'asc' },
      });
    }

    const subTask = await this.prisma.subTask.create({
      data: {
        taskId,
        unitId: primaryUnitId,
        taskAssigneeId: taskAssignee?.id ?? null,
        createdBy: userId,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? 'medium',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        status: 'pending',
        approvalDecision,
        approvalReviewedBy: approvalDecision === 'approved' ? userId : null,
        approvalReviewedAt: approvalDecision === 'approved' ? new Date() : null,
      },
      include: {
        unit: { select: { id: true, name: true } },
        task: { select: { id: true, title: true, priority: true, dueDate: true } },
        taskAssignee: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        reports: true,
        inventories: true,
      },
    });

    await this.prisma.subTaskUnit.createMany({
      data: unitIds.map((unitId) => ({ subTaskId: subTask.id, unitId })),
      skipDuplicates: true,
    });

    const updatedTask = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: { select: { id: true, name: true } },
        taskFloors: {
          include: { floor: { select: { id: true, name: true, floorNumber: true } } },
        },
        taskUnits: {
          include: {
            unit: {
              select: {
                id: true,
                name: true,
                floorId: true,
                floor: { select: { id: true, name: true, floorNumber: true } },
              },
            },
          },
        },
        subTasks: {
          orderBy: { createdAt: 'desc' },
          include: {
            unit: { select: { id: true, name: true } },
            subTaskUnits: {
              include: {
                unit: { select: { id: true, name: true } },
              },
            },
            taskAssignee: {
              include: {
                user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
                unit: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    return {
      message: '1 subtask created',
      data: this.toTaskWithSubTasksResponse(updatedTask),
    };
  }

  async reviewSubTaskCreation(
    taskId: string,
    subTaskId: string,
    dto: ReviewTaskDto,
    userId: string,
    userRole: string,
  ) {
    await this.verifyTaskAccess(taskId, userId, userRole);
    if (userRole !== UserRole.admin && userRole !== UserRole.manager && userRole !== UserRole.super_admin) {
      throw new ForbiddenException('Only admin or manager can review sub tasks');
    }

    const subTask = await this.prisma.subTask.findFirst({
      where: { id: subTaskId, taskId },
      include: { taskAssignee: true },
    });

    if (!subTask) throw new NotFoundException('Sub task not found');
    if (subTask.approvalDecision !== 'pending') {
      throw new BadRequestException('Sub task is already reviewed');
    }

    const nextStatus = dto.reviewDecision === 'approved' ? 'approved' : 'rejected';

    await this.prisma.subTask.update({
      where: { id: subTaskId },
      data: {
        approvalDecision: nextStatus,
        approvalReviewedBy: userId,
        approvalReviewedAt: new Date(),
        approvalNotes: dto.reviewDescription ?? null,
        status: dto.reviewDecision === 'approved' ? 'pending' : 'cancelled',
      },
    });

    if (subTask.taskAssignee?.userId) {
      await this.notificationsService.send({
        userId: subTask.taskAssignee.userId,
        title: dto.reviewDecision === 'approved' ? 'Subtask Approved' : 'Subtask Rejected',
        body: dto.reviewDescription ?? '',
        type: 'task',
        refId: subTaskId,
        refType: 'sub_task',
      });
    }

    return { message: `Sub task ${dto.reviewDecision}` };
  }

  async reviewTaskReport(
    taskId: string,
    reportId: string,
    dto: ReviewTaskDto,
    userId: string,
    userRole: string,
  ) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    const report = await this.prisma.taskReport.findFirst({
      where: { id: reportId, taskId },
      include: { subTask: true },
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

    await this.notificationsService.send({
      userId: report.workerId,
      title: dto.reviewDecision === 'approved' ? 'Subtask Report Approved' : 'Subtask Report Rejected',
      body: dto.reviewDescription ?? '',
      type: 'report',
      refId: reportId,
      refType: 'task_report',
    });

    if (report.subTaskId) {
      await this.prisma.subTask.update({
        where: { id: report.subTaskId },
        data: {
          status: dto.reviewDecision === 'approved' ? 'completed' : 'in_progress',
          submittedAt: dto.reviewDecision === 'approved' ? new Date() : undefined,
          completedAt: dto.reviewDecision === 'approved' ? new Date() : null,
        },
      });

      await this.refreshTaskProgress(taskId);
    }

    return { message: `Task report ${dto.reviewDecision}`, report: updated };
  }

  async reviewTaskCompletion(taskId: string, dto: ReviewTaskDto, userId: string, userRole: string) {
    await this.verifyTaskAccess(taskId, userId, userRole);

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { subTasks: true },
    });

    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== 'review') {
      throw new BadRequestException('Task is not ready for final review');
    }

    if (dto.reviewDecision === 'approved') {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          completionDecision: 'approved',
          completionReviewedBy: userId,
          completionReviewedAt: new Date(),
          completionNotes: dto.reviewDescription ?? null,
          status: 'completed',
        },
      });
      return { message: 'Task completed' };
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        completionDecision: 'rejected',
        completionReviewedBy: userId,
        completionReviewedAt: new Date(),
        completionNotes: dto.reviewDescription ?? null,
        status: 'in_progress',
      },
    });

    return { message: 'Task sent back to in progress' };
  }
}
