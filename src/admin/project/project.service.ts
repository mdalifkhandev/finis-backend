import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  AddFloorDto,
  UpdateFloorDto,
  AddRoomDto,
  UpdateRoomDto,
  CreateGeofenceDto,
} from './dto/project.dto';
import { UserStatus, UserRole, ProjectType, FloorStatus, ProjectStatus } from '../../generated/prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class ProjectService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) { }

  private readonly allowedHouseSections = ['basement', 'upstairs', 'main_floor', 'exterior'];

  private normalizeHouseSections(sections?: string[]) {
    if (!sections) return [];
    return [...new Set(sections.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  }

  private normalizeRange(min?: number, max?: number) {
    if (min === undefined && max === undefined) return { min: undefined, max: undefined };
    if (min !== undefined && max !== undefined && min > max) {
      throw new BadRequestException('Minimum value cannot be greater than maximum value.');
    }
    return { min, max };
  }

  private buildAutoFloorUnits(floorNumber: number, unitMin?: number | null, unitMax?: number | null) {
    const maxUnitValue = Math.max(
      unitMin !== undefined && unitMin !== null ? unitMin : 0,
      unitMax !== undefined && unitMax !== null ? unitMax : 0,
    );
    const suffixBase = maxUnitValue > 0 ? 10 ** Math.max(1, String(maxUnitValue).length - 1) : 100;
    const startSuffix = unitMin !== undefined && unitMin !== null ? unitMin % suffixBase : 1;
    const endSuffix = unitMax !== undefined && unitMax !== null ? unitMax % suffixBase : startSuffix;
    if (startSuffix > endSuffix) {
      throw new BadRequestException('Unit minimum cannot be greater than unit maximum.');
    }

    return Array.from({ length: endSuffix - startSuffix + 1 }, (_, index) => {
      const unitNumber = floorNumber * suffixBase + startSuffix + index;
      return {
        name: String(unitNumber),
        status: 'pending' as const,
        progress: 0,
      };
    });
  }

  private validateHouseSetup(type: ProjectType | null | undefined, isWholeHouse: boolean, houseSections: string[]) {
    if (type !== ProjectType.house) {
      return { isWholeHouse: false, houseSections: [] as string[] };
    }

    const invalid = houseSections.filter((section) => !this.allowedHouseSections.includes(section));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid house sections: ${invalid.join(', ')}. Allowed: ${this.allowedHouseSections.join(', ')}`,
      );
    }

    if (isWholeHouse) {
      return { isWholeHouse: true, houseSections: [] as string[] };
    }

    if (houseSections.length === 0) {
      throw new BadRequestException(
        'For house projects, either set isWholeHouse=true or provide at least one house section.',
      );
    }

    return { isWholeHouse: false, houseSections };
  }

  // ─── ACCESS VERIFY ─────────────────────────────────────────────────────────
  private isSuperAdmin(userRole?: string) {
    return userRole === UserRole.super_admin;
  }

  private async verifyCompanyAccess(companyId: string, userId: string, userRole?: string) {
    const company = await this.prisma.company.findFirst({
      where: this.isSuperAdmin(userRole) ? { id: companyId } : { id: companyId, ownerId: userId },
    });
    if (!company) throw new ForbiddenException('Company not found or not yours');
    return company;
  }

  private async verifyProjectAccess(projectId: string, userId: string, userRole?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { company: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (this.isSuperAdmin(userRole)) return project;

    if (project.company?.ownerId === userId) {
      return project;
    }

    if (userRole === UserRole.manager) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId, userId, role: 'manager' },
      });
      if (!member) throw new ForbiddenException('You are not assigned to this project');
    } else {
      if (project.managerId !== userId)
        throw new ForbiddenException('You do not have access to this project');
    }
    return project;
  }

  private async syncFloorAndProjectStatus(projectId: string, floorId: string) {
    const [floorRooms, projectRooms] = await Promise.all([
      this.prisma.unit.findMany({
        where: { floorId },
        select: { status: true },
      }),
      this.prisma.unit.findMany({
        where: { floor: { projectId } },
        select: { status: true },
      }),
    ]);

    const floorStatus = floorRooms.length === 0
      ? FloorStatus.pending
      : floorRooms.every((room) => room.status === 'completed')
        ? FloorStatus.completed
        : FloorStatus.in_progress;

    const projectStatus = projectRooms.length === 0
      ? ProjectStatus.planning
      : projectRooms.every((room) => room.status === 'completed')
        ? ProjectStatus.completed
        : ProjectStatus.active;

    await this.prisma.$transaction([
      this.prisma.floor.update({
        where: { id: floorId },
        data: { status: floorStatus },
      }),
      this.prisma.project.update({
        where: { id: projectId },
        data: { status: projectStatus },
      }),
    ]);
  }

  // ─── PLAN LIMIT CHECKS ────────────────────────────────────────────────────

  private async checkProjectLimit(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin?.tenantId) {
      throw new ForbiddenException('Please purchase a subscription before creating a project.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: admin.tenantId },
      include: { plan: { select: { maxProjects: true } } },
    });

    if (!tenant) {
      throw new ForbiddenException('Your subscription could not be verified.');
    }

    const isExpired =
      tenant.currentPeriodEnd != null &&
      new Date(tenant.currentPeriodEnd).getTime() < Date.now();

    if (tenant.status === 'suspended')
      throw new ForbiddenException('Your account is suspended. Please contact support.');
    if (tenant.status === 'cancelled')
      throw new ForbiddenException('Your subscription has been cancelled.');
    if (tenant.subscriptionStatus !== 'active' || isExpired)
      throw new ForbiddenException('Please activate a subscription before creating a project.');

    const max = tenant.plan.maxProjects;
    if (max === null || max === undefined) return; // unlimited

    // Tenant-wide project count so every company under the same subscription is included
    const currentCount = await this.prisma.project.count({
      where: { company: { tenantId: admin.tenantId } },
    });

    if (currentCount >= max) {
      throw new ForbiddenException(
        `Project limit reached (${currentCount}/${max}). Please upgrade your plan.`,
      );
    }
  }

  private async checkUserLimit(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin?.tenantId) {
      throw new ForbiddenException('Please purchase a subscription before adding users.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: admin.tenantId },
      include: { plan: { select: { maxUsers: true } }, _count: { select: { users: true } } },
    });

    if (!tenant) {
      throw new ForbiddenException('Your subscription could not be verified.');
    }

    if (tenant.status === 'suspended')
      throw new ForbiddenException('Your account is suspended. Please contact support.');
    if (tenant.status === 'cancelled')
      throw new ForbiddenException('Your subscription has been cancelled.');
    if (tenant.status === 'trial')
      throw new ForbiddenException('Please activate a subscription before adding users.');

    const max = tenant.plan.maxUsers;
    if (max === null || max === undefined) return; // unlimited

    if (tenant._count.users >= max) {
      throw new ForbiddenException(
        `User limit reached (${tenant._count.users}/${max}). Please upgrade your plan.`,
      );
    }
  }

  private async checkGeofencingAccess(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin?.tenantId) {
      throw new ForbiddenException('Please purchase a subscription to use geofencing.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: admin.tenantId },
      include: { plan: { select: { hasGeofencing: true } } },
    });

    if (!tenant) {
      throw new ForbiddenException('Your subscription could not be verified.');
    }

    if (tenant.status === 'suspended')
      throw new ForbiddenException('Your account is suspended. Please contact support.');
    if (tenant.status === 'cancelled')
      throw new ForbiddenException('Your subscription has been cancelled.');
    if (tenant.status === 'trial')
      throw new ForbiddenException('Please activate a subscription to use geofencing.');

    if (!tenant.plan.hasGeofencing) {
      throw new ForbiddenException(
        'Geofencing is not available on your current plan. Please upgrade.',
      );
    }
  }

  // ─── GET PROJECTS LIST ─────────────────────────────────────────────────────
  async getMyProjects(userId: string, userRole: string, status?: string, search?: string) {
    const projectSelect = {
      id: true,
      name: true,
      type: true,
      status: true,
      priority: true,
      isWholeHouse: true,
      houseSections: true,
      progress: true,
      startDate: true,
      endDate: true,
      budget: true,
      spent: true,
      remaining: true,
      location: true,
      numFloors: true,
      unitPerFloor: true,
      company: { select: { id: true, name: true, logoUrl: true } },
      _count: { select: { floors: true, tasks: true, teamMembers: true } },
      teamMembers: {
        take: 4,
        include: {
          user: { select: { id: true, fullName: true, avatarUrl: true } },
        },
      },
    };

    if (this.isSuperAdmin(userRole)) {
      return this.prisma.project.findMany({
        where: {
          ...(status && { status: status as any }),
          ...(search && {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
              { location: { contains: search, mode: 'insensitive' as const } },
            ],
          }),
        },
        orderBy: { createdAt: 'desc' },
        select: projectSelect,
      });
    }

    if (userRole === UserRole.manager) {
      return this.prisma.project.findMany({
        where: {
          teamMembers: { some: { userId, role: 'manager' } },
          ...(status && { status: status as any }),
          ...(search && {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
              { location: { contains: search, mode: 'insensitive' as const } },
            ],
          }),
        },
        orderBy: { createdAt: 'desc' },
        select: projectSelect,
      });
    }

    return this.prisma.project.findMany({
      where: {
        OR: [
          { managerId: userId },
          { company: { ownerId: userId } },
          { teamMembers: { some: { userId } } },
        ],
        ...(status && { status: status as any }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
            { location: { contains: search, mode: 'insensitive' as const } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
      select: projectSelect,
    });
  }

  async getProjectWorkerSummary(userId: string, userRole: string) {
    if (userRole !== UserRole.admin && userRole !== UserRole.super_admin) {
      throw new ForbiddenException('Access denied');
    }

    const companyWhere =
      userRole === UserRole.super_admin
        ? {}
        : { ownerId: userId, isActive: true };

    const companies = await this.prisma.company.findMany({
      where: companyWhere,
      select: { id: true },
    });
    const companyIds = companies.map((company) => company.id);

    const projects = await this.prisma.project.findMany({
      where: companyIds.length > 0
        ? { companyId: { in: companyIds } }
        : { id: { in: [] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        endDate: true,
        status: true,
        companyId: true,
        company: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            teamMembers: true,
          },
        },
      },
    });

    const workerCounts = await Promise.all(
      projects.map(async (project) => {
        const workerCount = await this.prisma.projectMember.count({
          where: {
            projectId: project.id,
            role: 'worker',
          },
        });

        return {
          projectId: project.id,
          projectName: project.name,
          endDate: project.endDate,
          status: project.status,
          company: project.company,
          workerCount,
          teamMemberCount: project._count.teamMembers,
        };
      }),
    );

    return {
      totalProjects: workerCounts.length,
      projects: workerCounts,
    };
  }



  async getMyProjectNames(userId: string, userRole: string) {
    const select = { id: true, name: true };

    if (this.isSuperAdmin(userRole)) {
      return this.prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        select,
      });
    }

    if (userRole === UserRole.manager) {
      return this.prisma.project.findMany({
        where: { teamMembers: { some: { userId, role: 'manager' } } },
        orderBy: { createdAt: 'desc' },
        select,
      });
    }

    return this.prisma.project.findMany({
      where: { managerId: userId },
      orderBy: { createdAt: 'desc' },
      select,
    });
  }

  // ─── CREATE PROJECT ────────────────────────────────────────────────────────
  async createProject(dto: CreateProjectDto, adminId: string, userRole?: string) {
    await this.verifyCompanyAccess(dto.companyId, adminId, userRole);

    //  Project limit check — super_admin skip
    if (!this.isSuperAdmin(userRole)) {
      await this.checkProjectLimit(adminId);
    }

    const normalizedSections = this.normalizeHouseSections(dto.houseSections);
    const houseSetup = this.validateHouseSetup(
      dto.type,
      dto.isWholeHouse ?? false,
      normalizedSections,
    );
    const numFloorsRange = this.normalizeRange(dto.numFloorsMin, dto.numFloorsMax);
    const unitRange = this.normalizeRange(dto.unitPerFloorMin, dto.unitPerFloorMax);
    const numFloorsValue = dto.numFloors ?? numFloorsRange.max ?? numFloorsRange.min ?? null;
    const unitPerFloorValue = dto.unitPerFloor ?? unitRange.max ?? unitRange.min ?? null;

    const project = await this.prisma.project.create({
      data: {
        companyId: dto.companyId,
        managerId: adminId,
        name: dto.name,
        type: dto.type,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        budget: dto.budget,
        location: dto.location,
        description: dto.description,
        ...(numFloorsValue !== null && { numFloors: numFloorsValue }),
        ...(numFloorsRange.min !== undefined && { numFloorsMin: numFloorsRange.min }),
        ...(numFloorsRange.max !== undefined && { numFloorsMax: numFloorsRange.max }),
        ...(unitPerFloorValue !== null && { unitPerFloor: unitPerFloorValue }),
        ...(unitRange.min !== undefined && { unitPerFloorMin: unitRange.min }),
        ...(unitRange.max !== undefined && { unitPerFloorMax: unitRange.max }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        isWholeHouse: houseSetup.isWholeHouse,
        houseSections: houseSetup.houseSections,
        status: 'planning',
        progress: 0,
      },
    });

    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
      select: { id: true, name: true },
    });

    await this.notificationsService.send({
      targetRole: 'super_admin',
      title: 'New project created',
      body: `${dto.name} project has been created${company?.name ? ` under ${company.name}` : ''}`,
      type: 'general',
      refType: 'project',
      refId: project.id,
    });

    if (dto.autoGenerateFloors && numFloorsValue && unitPerFloorValue) {
      const floorStart = numFloorsRange.min ?? 1;
      const floorEnd = numFloorsRange.max ?? numFloorsValue;
      for (let f = floorStart; f <= floorEnd; f++) {
        const floor = await this.prisma.floor.create({
          data: {
            projectId: project.id,
            name: f === 1 ? 'Ground Floor' : `Floor ${f}`,
            floorNumber: f,
            status: 'pending',
          },
        });
        await this.prisma.unit.createMany({
          data: this.buildAutoFloorUnits(f, unitRange.min, unitRange.max).map((unit) => ({
            floorId: floor.id,
            ...unit,
          })),
        });
      }
    }

    if (dto.floors && dto.floors.length > 0) {
      for (const floorData of dto.floors) {
        const floor = await this.prisma.floor.create({
          data: {
            projectId: project.id,
            name: floorData.name,
            floorNumber: floorData.floorNumber ?? 1,
            status: 'pending',
          },
        });
        if (floorData.units && floorData.units.length > 0) {
          await this.prisma.unit.createMany({
            data: floorData.units.map((r) => ({
              floorId: floor.id,
              name: r.name,
              type: r.type,
              sizeSqft: r.sizeSqft,
              status: 'pending' as const,
              progress: 0,
            })),
          });
        }
      }
    }

    return this.getProjectProfile(project.id, adminId, 'admin');
  }

  // ─── PROJECT PROFILE ───────────────────────────────────────────────────────
  async getProjectProfile(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        company: {
          select: {
            id: true, name: true, logoUrl: true, phone: true, email: true,
            website: true, address: true,
            contacts: {
              where: { isPrimary: true },
              select: { id: true, fullName: true, role: true, email: true, phone: true },
              take: 1,
            },
          },
        },
        expenses: { select: { amount: true, status: true } },
        _count: { select: { tasks: true, teamMembers: true, floors: true } },
      },
    });

    if (!project) throw new NotFoundException('Project not found');

    const primaryContact = project.company.contacts?.[0] ?? null;

    return {
      id: project.id,
      name: project.name,
      type: project.type,
      status: project.status,
      priority: project.priority,
      isWholeHouse: project.isWholeHouse,
      houseSections: project.houseSections,
      progress: project.progress,
      startDate: project.startDate,
      endDate: project.endDate,
      location: project.location,
      description: project.description,
      numFloors: project.numFloors,
      numFloorsMin: (project as any).numFloorsMin,
      numFloorsMax: (project as any).numFloorsMax,
      unitPerFloor: project.unitPerFloor,
      unitsPerFloor: project.unitPerFloor,
      unitPerFloorMin: (project as any).unitPerFloorMin,
      unitPerFloorMax: (project as any).unitPerFloorMax,
      budget: project.budget,
      spent: project.spent,
      remaining: project.remaining,
      client: {
        companyId: project.company.id,
        companyName: project.company.name,
        logoUrl: project.company.logoUrl,
        phone: project.company.phone,
        email: project.company.email,
        website: project.company.website,
        address: project.company.address,
        primaryContact,
      },
      counts: project._count,
    };
  }

  // ─── UPDATE PROJECT ────────────────────────────────────────────────────────
  async updateProject(projectId: string, dto: UpdateProjectDto, adminId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, adminId, userRole);

    if (dto.companyId) {
      await this.verifyCompanyAccess(dto.companyId, adminId, userRole);
    }

    const existingProject = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { budget: true, spent: true, type: true, isWholeHouse: true, houseSections: true },
    });

    const budget = dto.budget ?? existingProject?.budget ?? 0;
    const spent = dto.spent ?? existingProject?.spent ?? 0;
    const remaining = dto.remaining ?? budget - spent;

    const nextType = dto.type ?? existingProject?.type;
    const nextIsWholeHouse = dto.isWholeHouse ?? existingProject?.isWholeHouse ?? false;
    const nextSectionsSource = dto.houseSections ?? existingProject?.houseSections ?? [];
    const normalizedSections = this.normalizeHouseSections(nextSectionsSource);
    const houseSetup = this.validateHouseSetup(nextType, nextIsWholeHouse, normalizedSections);
    const nextNumFloorsRange = this.normalizeRange(dto.numFloorsMin, dto.numFloorsMax);
    const nextUnitRange = this.normalizeRange(dto.unitPerFloorMin, dto.unitPerFloorMax);
    const nextNumFloors = dto.numFloors ?? nextNumFloorsRange.max ?? nextNumFloorsRange.min ?? null;
    const nextUnitPerFloor = dto.unitPerFloor ?? nextUnitRange.max ?? nextUnitRange.min ?? null;

    // Prepare update payload
    const updateData: any = {
      ...(dto.name && { name: dto.name }),
      ...(dto.companyId && { companyId: dto.companyId }),
      ...(dto.type && { type: dto.type }),
      ...(dto.priority !== undefined && { priority: dto.priority }),

      ...(dto.progress !== undefined && {
        progress: dto.progress,
      }),

      isWholeHouse: houseSetup.isWholeHouse,
      houseSections: houseSetup.houseSections,

      ...(dto.status && { status: dto.status }),
      ...(dto.startDate && { startDate: new Date(dto.startDate) }),
      ...(dto.endDate && { endDate: new Date(dto.endDate) }),
      ...(nextNumFloors !== null && { numFloors: nextNumFloors }),
      ...(nextNumFloorsRange.min !== undefined && { numFloorsMin: nextNumFloorsRange.min }),
      ...(nextNumFloorsRange.max !== undefined && { numFloorsMax: nextNumFloorsRange.max }),
      ...(nextUnitPerFloor !== null && { unitPerFloor: nextUnitPerFloor }),
      ...(nextUnitRange.min !== undefined && { unitPerFloorMin: nextUnitRange.min }),
      ...(nextUnitRange.max !== undefined && { unitPerFloorMax: nextUnitRange.max }),
      ...(dto.budget !== undefined && { budget: dto.budget }),
      ...(dto.spent !== undefined && { spent: dto.spent }),
      ...(dto.location && { location: dto.location }),
      ...(dto.description !== undefined && { description: dto.description }),

      remaining,
    };

    // Update project metadata first
    const updatedProject = await this.prisma.project.update({
      where: { id: projectId },
      data: updateData,
      include: { company: { select: { id: true, name: true } } },
    });

    // Handle floor-plan updates: either auto-generate or replace with provided floors
    // If requested, remove existing floors and recreate according to payload
    if (dto.autoGenerateFloors && nextNumFloors && nextUnitPerFloor) {
      // wipe existing floors
      await this.prisma.floor.deleteMany({ where: { projectId } });

      const floorStart = nextNumFloorsRange.min ?? 1;
      const floorEnd = nextNumFloorsRange.max ?? nextNumFloors;
      for (let floorNumber = floorStart; floorNumber <= floorEnd; floorNumber++) {
        const units = this.buildAutoFloorUnits(floorNumber, nextUnitRange.min, nextUnitRange.max);
        await this.prisma.floor.create({
          data: {
            projectId,
            name: floorNumber === 1 ? 'Ground Floor' : `Floor ${floorNumber}`,
            floorNumber,
            status: 'pending',
            units: { create: units },
          },
        });
      }
    } else if (dto.floors && dto.floors.length > 0) {
      // Replace existing floors with provided structure
      await this.prisma.floor.deleteMany({ where: { projectId } });

      for (let idx = 0; idx < dto.floors.length; idx++) {
        const f = dto.floors[idx];
        const unitsToCreate = (f.units ?? []).map((r: any) => ({
          name: r.name,
          type: r.type,
          sizeSqft: r.sizeSqft,
          status: r.status ?? 'pending',
          progress: r.progress ?? 0,
        }));

        await this.prisma.floor.create({
          data: {
            projectId,
            name: f.name,
            floorNumber: typeof f.floorNumber === 'number' ? f.floorNumber : idx + 1,
            status: f.status ?? 'pending',
            units: { create: unitsToCreate },
          },
        });
      }
    }

    // Return full profile like createProject
    return this.getProjectProfile(updatedProject.id, adminId, userRole);
  }

  // ─── DELETE PROJECT ────────────────────────────────────────────────────────
  async deleteProject(projectId: string, adminId: string, userRole?: string) {
    await this.verifyProjectAccess(projectId, adminId, userRole);
    await this.prisma.project.delete({ where: { id: projectId } });
    return { message: 'Project deleted successfully' };
  }

  // ─── FLOOR PLAN ────────────────────────────────────────────────────────────
  async getFloorPlan(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const floors = await this.prisma.floor.findMany({
      where: { projectId },
      orderBy: { floorNumber: 'asc' },
      include: {
        units: {
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { tasks: true } },
            tasks: { select: { status: true } },
          },
        },
        _count: { select: { tasks: true, units: true } },
        tasks: { select: { status: true } },
      },
    });

    return floors.map((floor) => ({
      id: floor.id,
      name: floor.name,
      floorNumber: floor.floorNumber,
      status: floor.status,
      progress: floor.progress,
      totalUnits: floor.units.length,
      taskCounts: {
        total: floor.tasks.length,
        completed: floor.tasks.filter((t) => t.status === 'completed').length,
        inProgress: floor.tasks.filter((t) => t.status === 'in_progress').length,
        notStarted: floor.tasks.filter((t) => t.status === 'pending').length,
      },
      units: floor.units.map((room) => ({
        id: room.id,
        name: room.name,
        type: room.type,
        sizeSqft: room.sizeSqft,
        status: room.status,
        progress: room.progress,
        taskCounts: {
          total: room.tasks.length,
          completed: room.tasks.filter((t) => t.status === 'completed').length,
          inProgress: room.tasks.filter((t) => t.status === 'in_progress').length,
          notStarted: room.tasks.filter((t) => t.status === 'pending').length,
        },
      })),
    }));
  }

  async getFloorNames(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const floors = await this.prisma.floor.findMany({
      where: { projectId },
      orderBy: { floorNumber: 'asc' },
      select: { id: true, name: true, floorNumber: true, status: true, progress: true },
    });

    return floors.map((floor) => ({
      id: floor.id,
      floorNumber: floor.floorNumber,
      name: floor.name,
      status: floor.status,
      progress: floor.progress,
    }));
  }

  // ─── PROJECT ANALYSIS ──────────────────────────────────────────────────────
  async getProjectAnalysis(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        floors: {
          orderBy: { floorNumber: 'asc' },
          include: {
            tasks: {
              include: { assignee: { select: { id: true, fullName: true, avatarUrl: true } } },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!project) throw new NotFoundException('Project not found');

    const checklist = project.floors.map((floor) => ({
      floorId: floor.id,
      floorName: floor.name,
      floorStatus: floor.status,
      tasks: floor.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        isCompleted: task.status === 'completed',
        unitCount: task.estimatedHours ?? 0,
        dueDate: task.dueDate,
        assignee: task.assignee,
        status: task.status,
        priority: task.priority,
      })),
    }));

    return { checklist };
  }

  // ─── PROJECT APPROVALS ─────────────────────────────────────────────────────
  async getProjectApprovals(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const [summary, recentReports, relatedTasks] = await Promise.all([
      this.prisma.taskReport.groupBy({
        by: ['reviewDecision'],
        where: { task: { projectId } },
        _count: { reviewDecision: true },
      }),
      this.prisma.taskReport.findMany({
        where: { task: { projectId } },
        orderBy: { submittedAt: 'desc' },
        take: 12,
        select: {
          id: true,
          taskId: true,
          workerId: true,
          notes: true,
          beforePhotoUrl: true,
          afterPhotoUrl: true,
          receiptUrl: true,
          reviewDecision: true,
          reviewDescription: true,
          submittedAt: true,
          reviewedAt: true,
        },
      }),
      this.prisma.task.findMany({
        where: { projectId },
        select: {
          id: true,
          title: true,
          status: true,
          floor: { select: { id: true, name: true, floorNumber: true } },
          unit: { select: { id: true, name: true } },
          taskAssignees: {
            select: {
              user: { select: { id: true, fullName: true, avatarUrl: true } },
            },
            take: 1,
          },
        },
      }),
    ]);

    const summaryMap = summary.reduce<Record<string, number>>((acc, item) => {
      acc[item.reviewDecision] = item._count.reviewDecision;
      return acc;
    }, {});

    const pending = summaryMap.pending ?? 0;
    const approved = summaryMap.approved ?? 0;
    const rejected = summaryMap.rejected ?? 0;
    const total = pending + approved + rejected;
    const taskMap = new Map(relatedTasks.map((task) => [task.id, task]));

    return {
      summary: {
        total,
        pending,
        approved,
        rejected,
      },
      recentApprovals: recentReports.map((report) => ({
        id: report.id,
        taskId: report.taskId,
        taskTitle: taskMap.get(report.taskId)?.title ?? 'Task',
        taskStatus: taskMap.get(report.taskId)?.status ?? 'pending',
        floor: taskMap.get(report.taskId)?.floor
          ? {
              id: taskMap.get(report.taskId)!.floor!.id,
              name: taskMap.get(report.taskId)!.floor!.name,
              floorNumber: taskMap.get(report.taskId)!.floor!.floorNumber,
            }
          : null,
        unit: taskMap.get(report.taskId)?.unit
          ? {
              id: taskMap.get(report.taskId)!.unit!.id,
              name: taskMap.get(report.taskId)!.unit!.name,
            }
          : null,
        worker: taskMap.get(report.taskId)?.taskAssignees[0]?.user ?? null,
        reviewDecision: report.reviewDecision,
        reviewDescription: report.reviewDescription,
        notes: report.notes,
        beforePhotoUrl: report.beforePhotoUrl,
        afterPhotoUrl: report.afterPhotoUrl,
        receiptUrl: report.receiptUrl,
        submittedAt: report.submittedAt,
        reviewedAt: report.reviewedAt,
      })),
    };
  }

  // ─── FLOORS CRUD ───────────────────────────────────────────────────────────
  async addFloor(projectId: string, dto: AddFloorDto, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    if (!dto || !dto.name) {
      throw new BadRequestException('Floor name is required');
    }

    const existingFloorCount = await this.prisma.floor.count({ where: { projectId } });
    const nextNumber = existingFloorCount + 1;

    const floor = await this.prisma.floor.create({
      data: {
        projectId,
        name: dto.name,
        floorNumber: nextNumber,
      },
    });

    return this.prisma.floor.findUnique({
      where: { id: floor.id },
      include: { units: true, _count: { select: { tasks: true, units: true } } },
    });
  }

  async updateFloor(projectId: string, floorId: string, dto: UpdateFloorDto, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, projectId } });
    if (!floor) throw new NotFoundException('Floor not found');
    return this.prisma.floor.update({
      where: { id: floorId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.floorNumber !== undefined && { floorNumber: dto.floorNumber }),
        ...(dto.status && { status: dto.status }),
        ...(dto.progress !== undefined && { progress: dto.progress }),
      },
      include: { units: true },
    });
  }

  async deleteFloor(projectId: string, floorId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, projectId } });
    if (!floor) throw new NotFoundException('Floor not found');
    await this.prisma.floor.delete({ where: { id: floorId } });
    return { message: 'Floor deleted successfully' };
  }

  // ─── UNITS CRUD ────────────────────────────────────────────────────────────
  async addRoom(projectId: string, floorId: string, dto: AddRoomDto, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const floor = await this.prisma.floor.findUnique({ where: { id: floorId } });
    if (!floor || floor.projectId !== projectId) {
      throw new NotFoundException('Floor not found for this project');
    }

    const parseRoomLabel = (value: string) => {
      const trimmed = value.trim();
      const match = trimmed.match(/^(.*?)(\d+)$/);

      if (!match) {
        throw new BadRequestException('Unit number must end with digits, like A1 or Y20');
      }

      return {
        prefix: match[1],
        number: Number(match[2]),
        rawNumber: match[2],
      };
    };

    const start = parseRoomLabel(dto.startRoomNumber);
    const end = parseRoomLabel(dto.endRoomNumber);

    if (start.prefix !== end.prefix) {
      throw new BadRequestException('Start and end unit prefix must be the same');
    }

    const from = Math.min(start.number, end.number);
    const to = Math.max(start.number, end.number);

    if (from < 1) {
      throw new BadRequestException('Unit number must start from 1 or greater');
    }

    if (to - from + 1 > 200) {
      throw new BadRequestException('Too many units requested');
    }

    const numberWidth = Math.max(start.rawNumber.length, end.rawNumber.length);

    const unitsData = Array.from({ length: to - from + 1 }, (_, index) => {
      const roomNumber = from + index;
      return {
        floorId,
        name: `${start.prefix}${String(roomNumber).padStart(numberWidth, '0')}`,
        status: 'pending' as const,
        progress: 0,
      };
    });

    await this.prisma.unit.createMany({ data: unitsData });

    await this.syncFloorAndProjectStatus(projectId, floorId);

    return { message: `${unitsData.length} units created` };
  }

  async getRoomNames(projectId: string, floorId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const floor = await this.prisma.floor.findUnique({
      where: { id: floorId },
      select: { id: true, projectId: true },
    });

    if (!floor || floor.projectId !== projectId) {
      throw new NotFoundException('Floor not found for this project');
    }

    const units = await this.prisma.unit.findMany({
      where: { floorId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true, progress: true, type: true },
    });

    return units.map((room) => {
      const match = room.name.trim().match(/^(.*?)(\d+)$/);
      return {
        id: room.id,
        roomNumber: match ? Number(match[2]) : null,
        name: room.name,
        status: room.status,
        progress: room.progress,
        type: room.type,
      };
    });
  }

  async updateRoom(projectId: string, unitId: string, dto: UpdateRoomDto, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const room = await this.prisma.unit.findFirst({
      where: { id: unitId, floor: { projectId } },
      select: { id: true, floorId: true },
    });
    if (!room) throw new NotFoundException('Unit not found');

    const updatedUnit = await this.prisma.unit.update({
      where: { id: unitId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.sizeSqft !== undefined && { sizeSqft: dto.sizeSqft }),
        ...(dto.status && { status: dto.status }),
        ...(dto.progress !== undefined && { progress: dto.progress }),
      },
    });

    await this.syncFloorAndProjectStatus(projectId, room.floorId);

    return updatedUnit;
  }

  async deleteRoom(projectId: string, unitId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const room = await this.prisma.unit.findFirst({
      where: { id: unitId, floor: { projectId } },
      select: { id: true, floorId: true },
    });
    if (!room) throw new NotFoundException('Unit not found');
    await this.prisma.unit.delete({ where: { id: unitId } });

    await this.syncFloorAndProjectStatus(projectId, room.floorId);

    return { message: 'Unit deleted successfully' };
  }


  async getManagers(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const managers = await this.prisma.projectMember.findMany({
      where: { projectId, role: 'manager' },
      include: { user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true, status: true, department: true } } },
    });

    return managers.map((m) => ({ memberId: m.id, ...m.user }));
  }

  async getWorkers(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const workers = await this.prisma.projectMember.findMany({
      where: { projectId, role: 'worker' },
      include: { user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true, status: true, department: true } } },
    });

    return workers.map((w) => ({ memberId: w.id, managerId: w.managerId, ...w.user }));
  }

  async getWorkerDetails(projectId: string, workerId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: workerId, role: 'worker' },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true } },
      },
    });

    if (!member) throw new NotFoundException('Worker not found in project');

    // fetch tasks assigned to this user
    const tasks = await this.prisma.task.findMany({
      where: { projectId, assignee: { id: workerId } },
      select: { id: true, title: true, status: true, dueDate: true, priority: true },
      orderBy: { createdAt: 'desc' },
    });

    const stats = {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      notStarted: tasks.filter((t) => t.status === 'pending').length,
    };

    // load manager user info if managerId is present
    let managerUser: { id: string; fullName: string; avatarUrl: string | null } | null = null;
    if (member.managerId) {
      managerUser = await this.prisma.user.findUnique({
        where: { id: member.managerId },
        select: { id: true, fullName: true, avatarUrl: true },
      });
    }

    return {
      memberId: member.id,
      user: member.user,
      managerId: member.managerId ?? null,
      manager: managerUser,
      joinedAt: member.createdAt,
      tasks,
      stats,
    };
  }

  async getProjectDocuments(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const documents = await this.prisma.document.findMany({
      where: { projectId },
      orderBy: { uploadedAt: 'desc' },
      include: {
        uploadedByUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      fileUrl: document.fileUrl,
      fileType: document.fileType,
      fileSizeMb: document.fileSizeMb,
      uploadedAt: document.uploadedAt,
      uploadedBy: document.uploadedByUser,
    }));
  }

  async uploadProjectDocument(
    projectId: string,
    userId: string,
    userRole: string,
    file?: { originalname: string; filename: string; size: number; mimetype: string },
    fileUrl?: string,
  ) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    if (!file) {
      throw new BadRequestException('file is required');
    }
    if (!fileUrl) {
      throw new BadRequestException('S3 upload failed');
    }

    const fileSizeMb = file.size / (1024 * 1024);

    const document = await this.prisma.document.create({
      data: {
        projectId,
        uploadedBy: userId,
        fileName: file.originalname,
        fileUrl,
        fileType: file.mimetype,
        fileSizeMb: Math.round(fileSizeMb * 100) / 100,
      },
      include: {
        uploadedByUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return {
      message: 'Document uploaded successfully',
      document: {
        id: document.id,
        fileName: document.fileName,
        fileUrl: document.fileUrl,
        fileType: document.fileType,
        fileSizeMb: document.fileSizeMb,
        uploadedAt: document.uploadedAt,
        uploadedBy: document.uploadedByUser,
      },
    };
  }

  async deleteProjectDocument(projectId: string, docId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const document = await this.prisma.document.findFirst({
      where: { id: docId, projectId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.prisma.document.delete({
      where: { id: docId },
    });

    return {
      message: 'Document deleted successfully',
    };
  }

  async getManagerWorkersCount(projectId: string, managerId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const count = await this.prisma.projectMember.count({
      where: { projectId, role: 'worker', managerId },
    });

    return { projectId, managerId, count };
  }

  async getWorkersByManager(projectId: string, managerId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const workers = await this.prisma.projectMember.findMany({
      where: { projectId, role: 'worker', managerId },
      include: { user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true, status: true, department: true } } },
    });

    return workers.map((w) => ({ memberId: w.id, managerId: w.managerId, ...w.user }));
  }

  async getAvailableByRole(adminId: string, role: 'manager' | 'worker', page = 1, limit = 10, search?: string, userRole?: string) {
    const whereInvitation: any = { receiverId: { not: null } };
    if (userRole !== UserRole.admin && userRole !== UserRole.super_admin) {
      whereInvitation.senderId = adminId;
    }
    const invitations = await this.prisma.invitation.findMany({ where: whereInvitation, select: { receiverId: true } });
    const invitedUserIds = invitations.map((i) => i.receiverId).filter(Boolean) as string[];
    if (invitedUserIds.length === 0) return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };

    const skip = (page - 1) * limit;
    const where = {
      id: { in: invitedUserIds },
      role: role === 'manager' ? UserRole.manager : UserRole.worker,
      status: UserStatus.active,
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true, department: true }, orderBy: { fullName: 'asc' }, skip, take: limit }),
      this.prisma.user.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async addMemberByRole(projectId: string, userId: string, adminId: string, role: 'manager' | 'worker', managerId?: string, userRole?: string) {
    await this.verifyProjectAccess(projectId, adminId, userRole);
    if (!this.isSuperAdmin(userRole)) {
      await this.checkUserLimit(adminId);
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, managerId: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== role) throw new BadRequestException(`Only users with role '${role}' can be added as ${role}`);
    const existing = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    if (existing) throw new BadRequestException('User is already a team member');
    if (userRole === UserRole.manager && role === 'manager') throw new ForbiddenException('Managers cannot add other managers');

    if (role === 'worker') {
      const fallbackManagerId = managerId || project.managerId || (await this.prisma.projectMember.findFirst({
        where: { projectId, role: 'manager' },
        select: { userId: true },
        orderBy: { createdAt: 'asc' },
      }))?.userId;

      if (!fallbackManagerId) {
        throw new BadRequestException('No manager is assigned to this project. Add a manager first or choose one.');
      }

      const manager = await this.prisma.projectMember.findFirst({ where: { projectId, userId: fallbackManagerId, role: 'manager' } });
      if (!manager) throw new NotFoundException('Manager not found in this project');

      managerId = fallbackManagerId;
    }

    try {
      const member = await this.prisma.projectMember.create({
        data: { projectId, userId, role, ...(managerId && { managerId }) },
        include: { user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true } } },
      });
      if (role === 'worker' && managerId) {
        const existingMap = await this.prisma.workerManagerMap.findFirst({ where: { workerId: userId, managerId } });
        if (!existingMap) {
          try {
            await this.prisma.workerManagerMap.create({ data: { managerId, workerId: userId } });
          } catch (e) {
            if ((e as any)?.code !== 'P2002') throw e;
          }
        }
      }

      if (role === 'worker') {
        await this.notificationsService.send({
          userId,
          title: 'Project Assigned',
          body: `You have been assigned to project: ${project.name}`,
          type: 'project',
          refId: projectId,
          refType: 'project',
        });

        if (managerId && managerId !== userId) {
          await this.notificationsService.send({
            userId: managerId,
            title: 'Worker Assigned',
            body: `${member.user.fullName} has been assigned to project: ${project.name}`,
            type: 'project',
            refId: projectId,
            refType: 'project',
          });
        }
      }

      if (role === 'manager') {
        await this.notificationsService.send({
          userId,
          title: 'Project Manager Added',
          body: `You have been added as manager to project: ${project.name}`,
          type: 'project',
          refId: projectId,
          refType: 'project',
        });
      }

      return { message: `${role} added successfully`, member: { memberId: member.id, ...member.user } };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('This user is already assigned in the project.');
      }
      if (error?.code === 'P2003') {
        throw new BadRequestException('Invalid relation data while assigning team member.');
      }
      throw error;
    }
  }

  async removeTeamMember(projectId: string, userId: string, adminId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, adminId, userRole);
    const member = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    if (!member) throw new NotFoundException('Member not found');

    // Clean up any worker-manager mappings related to this member
    if (member.role === 'manager') {
      await this.prisma.workerManagerMap.deleteMany({ where: { managerId: userId } });
    }
    if (member.role === 'worker') {
      await this.prisma.workerManagerMap.deleteMany({ where: { workerId: userId } });
    }

    await this.prisma.projectMember.delete({ where: { id: member.id } });
    return { message: 'Member removed successfully' };
  }

  // ─── GEOFENCES ─────────────────────────────────────────────────────────────
  async getGeofences(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    return this.prisma.geofence.findMany({ where: { projectId } });
  }

  async createGeofence(projectId: string, dto: CreateGeofenceDto, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const existing = await this.prisma.geofence.findFirst({
      where: { projectId },
    });
    if (existing) {
      throw new BadRequestException(
        'A geofence already exists for this project. Please update the existing one.',
      );
    }
    // ✅ Geofencing plan check — super_admin এর জন্য skip
    if (!this.isSuperAdmin(userRole)) {
      await this.checkGeofencingAccess(userId);
    }

    return this.prisma.geofence.create({
      data: {
        projectId,
        zoneName: dto.zoneName,
        polygonCoords: dto.polygonCoords as any,
        totalAreaSqft: dto.totalAreaSqft,
        perimeterFt: dto.perimeterFt,
        isActive: true,
      },
    });
  }

  async updateGeofence(projectId: string, geofenceId: string, dto: Partial<CreateGeofenceDto> & { isActive?: boolean }, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const geo = await this.prisma.geofence.findFirst({ where: { id: geofenceId, projectId } });
    if (!geo) throw new NotFoundException('Geofence not found');
    const { polygonCoords, ...rest } = dto;
    return this.prisma.geofence.update({
      where: { id: geofenceId },
      data: { ...rest, ...(polygonCoords !== undefined && { polygonCoords: polygonCoords as any }) },
    });
  }

  async resolveViolation(violationId: string, userId: string, userRole?: string) {
    const violation = await this.prisma.geofenceViolation.findUnique({
      where: { id: violationId },
      include: { geofence: { select: { projectId: true } } },
    });
    if (!violation) throw new NotFoundException('Violation not found');
    await this.verifyProjectAccess(violation.geofence.projectId, userId, userRole);
    await this.prisma.geofenceViolation.update({ where: { id: violationId }, data: { isResolved: true } });
    return { message: 'Violation resolved' };
  }

  async deleteGeofence(projectId: string, geofenceId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const geo = await this.prisma.geofence.findFirst({ where: { id: geofenceId, projectId } });
    if (!geo) throw new NotFoundException('Geofence not found');
    await this.prisma.geofence.delete({ where: { id: geofenceId } });
    return { message: 'Geofence deleted successfully' };
  }

  // ─── LOCATION LOGS ─────────────────────────────────────────────────────────
  async getLocationLogs(projectId: string, userId: string, userRole: string, page = 1, limit = 20) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const skip = (page - 1) * limit;

    const projectMembers = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });

    const projectUserIds = projectMembers.map((member) => member.userId);

    const where = projectUserIds.length > 0
      ? {
          OR: [
            { geofence: { projectId } },
            { userId: { in: projectUserIds } },
          ],
        }
      : { geofence: { projectId } };

    const [logs, total] = await Promise.all([
      this.prisma.locationLog.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          geofence: { select: { id: true, zoneName: true } },
        },
        orderBy: { loggedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.locationLog.count({ where }),
    ]);
    return {
      data: logs.map((log) => ({
        id: log.id,
        worker: log.user,
        lat: log.lat,
        lng: log.lng,
        eventType: log.eventType,
        durationSeconds: log.durationSeconds ?? null,
        zoneName: log.geofence?.zoneName ?? null,
        loggedAt: log.loggedAt,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── VIOLATIONS ────────────────────────────────────────────────────────────
  async getViolations(projectId: string, userId: string, userRole: string, page = 1, limit = 20) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const skip = (page - 1) * limit;
    const [violations, total] = await Promise.all([
      this.prisma.geofenceViolation.findMany({
        where: { geofence: { projectId } },
        include: { geofence: { select: { id: true, zoneName: true } } },
        orderBy: { occurredAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.geofenceViolation.count({ where: { geofence: { projectId } } }),
    ]);
    return {
      data: violations.map((v) => ({
        id: v.id,
        geofenceName: v.geofence.zoneName,
        distanceM: v.distanceM,
        description: v.description,
        isResolved: v.isResolved,
        occurredAt: v.occurredAt,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTimeSummary(
    projectId: string,
    userId: string,
    userRole: string,
    date?: string,
  ) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const workers = await this.prisma.projectMember.findMany({
      where: { projectId, role: 'worker' },
      include: {
        user: {
          select: { id: true, fullName: true, avatarUrl: true },
        },
      },
    });

    const result = await Promise.all(
      workers.map(async (member) => {
        const attendance = await this.prisma.attendance.findFirst({
          where: {
            userId: member.userId,
            date: { gte: targetDate, lt: nextDay },
          },
          include: { sessions: true },
        });

        const totalZoneSeconds =
          attendance?.sessions.reduce((sum, s) => sum + (s.zoneSeconds ?? 0), 0) ?? 0;
        const totalOutsideSeconds =
          attendance?.sessions.reduce((sum, s) => sum + (s.outsideSeconds ?? 0), 0) ?? 0;

        return {
          workerId: member.userId,
          workerName: member.user.fullName,
          avatarUrl: member.user.avatarUrl,
          date: targetDate,
          totalZoneHours: Math.round((totalZoneSeconds / 3600) * 100) / 100,
          totalOutsideHours: Math.round((totalOutsideSeconds / 3600) * 100) / 100,
          sessions: attendance?.sessions.map((s) => ({
            sessionId: s.id,
            checkIn: s.checkInTime,
            checkOut: s.checkOutTime,
            zoneHours: Math.round(((s.zoneSeconds ?? 0) / 3600) * 100) / 100,
            outsideHours: Math.round(((s.outsideSeconds ?? 0) / 3600) * 100) / 100,
          })) ?? [],
        };
      }),
    );

    return { projectId, date: targetDate, workers: result };
  }
}
