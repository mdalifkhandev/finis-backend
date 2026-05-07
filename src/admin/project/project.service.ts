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
import { UserStatus, UserRole } from '../../generated/prisma/client';

@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService) { }

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

  // ─── PLAN LIMIT CHECKS ────────────────────────────────────────────────────

  private async checkProjectLimit(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin?.tenantId) return; // পুরনো account — limit নেই

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: admin.tenantId },
      include: { plan: { select: { maxProjects: true } } },
    });

    if (!tenant) return;

    if (tenant.status === 'suspended')
      throw new ForbiddenException('Your account is suspended. Please contact support.');
    if (tenant.status === 'cancelled')
      throw new ForbiddenException('Your subscription has been cancelled.');

    const max = tenant.plan.maxProjects;
    if (max === null || max === undefined) return; // unlimited

    // company → ownerId দিয়ে সব project count
    const currentCount = await this.prisma.project.count({
      where: { company: { ownerId: adminId } },
    });

    if (currentCount >= max) {
      throw new ForbiddenException(
        `Project limit reached (${currentCount}/${max}). Please upgrade your plan.`,
      );
    }
  }

  private async checkGeofencingAccess(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin?.tenantId) return; // পুরনো account — limit নেই

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: admin.tenantId },
      include: { plan: { select: { hasGeofencing: true } } },
    });

    if (!tenant) return;

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
      progress: true,
      startDate: true,
      endDate: true,
      budget: true,
      spent: true,
      remaining: true,
      location: true,
      numFloors: true,
      roomsPerFloor: true,
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
        managerId: userId,
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

  // ─── CREATE PROJECT ────────────────────────────────────────────────────────
  async createProject(dto: CreateProjectDto, adminId: string, userRole?: string) {
    await this.verifyCompanyAccess(dto.companyId, adminId, userRole);

    // ✅ Project limit check — super_admin এর জন্য skip
    if (!this.isSuperAdmin(userRole)) {
      await this.checkProjectLimit(adminId);
    }

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
        numFloors: dto.numFloors,
        roomsPerFloor: dto.roomsPerFloor,
        status: 'planning',
        progress: 0,
      },
    });

    if (dto.autoGenerateFloors && dto.numFloors && dto.roomsPerFloor) {
      for (let f = 1; f <= dto.numFloors; f++) {
        const floor = await this.prisma.floor.create({
          data: {
            projectId: project.id,
            name: f === 1 ? 'Ground Floor' : `Floor ${f}`,
            floorNumber: f,
            status: 'pending',
          },
        });
        await this.prisma.room.createMany({
          data: Array.from({ length: dto.roomsPerFloor }, (_, r) => ({
            floorId: floor.id,
            name: `Room ${r + 1}`,
            status: 'pending' as const,
            progress: 0,
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
        if (floorData.rooms && floorData.rooms.length > 0) {
          await this.prisma.room.createMany({
            data: floorData.rooms.map((r) => ({
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
      progress: project.progress,
      startDate: project.startDate,
      endDate: project.endDate,
      location: project.location,
      description: project.description,
      numFloors: project.numFloors,
      roomsPerFloor: project.roomsPerFloor,
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
      select: { budget: true, spent: true },
    });

    const budget = dto.budget ?? existingProject?.budget ?? 0;
    const spent = dto.spent ?? existingProject?.spent ?? 0;
    const remaining = dto.remaining ?? budget - spent;

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.companyId && { companyId: dto.companyId }),
        ...(dto.type && { type: dto.type }),
        ...(dto.status && { status: dto.status }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate && { endDate: new Date(dto.endDate) }),
        ...(dto.numFloors !== undefined && { numFloors: dto.numFloors }),
        ...(dto.roomsPerFloor !== undefined && { roomsPerFloor: dto.roomsPerFloor }),
        ...(dto.budget !== undefined && { budget: dto.budget }),
        ...(dto.spent !== undefined && { spent: dto.spent }),
        ...(dto.location && { location: dto.location }),
        ...(dto.description !== undefined && { description: dto.description }),
        remaining,
      },
      include: { company: { select: { id: true, name: true } } },
    });
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
        rooms: {
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { tasks: true } },
            tasks: { select: { status: true } },
          },
        },
        _count: { select: { tasks: true, rooms: true } },
        tasks: { select: { status: true } },
      },
    });

    return floors.map((floor) => ({
      id: floor.id,
      name: floor.name,
      floorNumber: floor.floorNumber,
      status: floor.status,
      progress: floor.progress,
      totalRooms: floor.rooms.length,
      taskCounts: {
        total: floor.tasks.length,
        completed: floor.tasks.filter((t) => t.status === 'completed').length,
        inProgress: floor.tasks.filter((t) => t.status === 'in_progress').length,
        notStarted: floor.tasks.filter((t) => t.status === 'pending').length,
      },
      rooms: floor.rooms.map((room) => ({
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

  // ─── FLOORS CRUD ───────────────────────────────────────────────────────────
  async addFloor(projectId: string, dto: AddFloorDto, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const floor = await this.prisma.floor.create({
      data: { projectId, name: dto.name, floorNumber: dto.floorNumber, status: 'pending' },
    });
    if (dto.rooms && dto.rooms.length > 0) {
      await this.prisma.room.createMany({
        data: dto.rooms.map((r) => ({
          floorId: floor.id,
          name: r.name,
          type: r.type,
          sizeSqft: r.sizeSqft,
          status: 'pending' as const,
          progress: 0,
        })),
      });
    }
    return this.prisma.floor.findUnique({
      where: { id: floor.id },
      include: { rooms: true, _count: { select: { tasks: true, rooms: true } } },
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
      include: { rooms: true },
    });
  }

  async deleteFloor(projectId: string, floorId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, projectId } });
    if (!floor) throw new NotFoundException('Floor not found');
    await this.prisma.floor.delete({ where: { id: floorId } });
    return { message: 'Floor deleted successfully' };
  }

  // ─── ROOMS CRUD ────────────────────────────────────────────────────────────
  async addRoom(projectId: string, floorId: string, dto: AddRoomDto, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, projectId } });
    if (!floor) throw new NotFoundException('Floor not found');
    return this.prisma.room.create({
      data: { floorId, name: dto.name, type: dto.type, sizeSqft: dto.sizeSqft, status: 'pending', progress: 0 },
    });
  }

  async updateRoom(projectId: string, roomId: string, dto: UpdateRoomDto, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const room = await this.prisma.room.findFirst({ where: { id: roomId, floor: { projectId } } });
    if (!room) throw new NotFoundException('Room not found');
    return this.prisma.room.update({
      where: { id: roomId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.sizeSqft !== undefined && { sizeSqft: dto.sizeSqft }),
        ...(dto.status && { status: dto.status }),
        ...(dto.progress !== undefined && { progress: dto.progress }),
      },
    });
  }

  async deleteRoom(projectId: string, roomId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const room = await this.prisma.room.findFirst({ where: { id: roomId, floor: { projectId } } });
    if (!room) throw new NotFoundException('Room not found');
    await this.prisma.room.delete({ where: { id: roomId } });
    return { message: 'Room deleted successfully' };
  }

  // ─── TEAM ──────────────────────────────────────────────────────────────────
  async getTeamMembers(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true, status: true, department: true },
        },
      },
    });
    const managers = members.filter((m) => m.role === 'manager').map((m) => ({ memberId: m.id, ...m.user }));
    const workers = members.filter((m) => m.role === 'worker').map((m) => ({ memberId: m.id, managerId: m.managerId, ...m.user }));
    return { total: members.length, managers, workers };
  }

  async getAvailableByRole(adminId: string, role: 'manager' | 'worker', page = 1, limit = 10, search?: string, userRole?: string) {
    const whereInvitation: any = { status: 'accepted', receiverId: { not: null } };
    if (userRole !== UserRole.admin && userRole !== UserRole.super_admin) {
      whereInvitation.senderId = adminId;
    }
    const acceptedInvitations = await this.prisma.invitation.findMany({ where: whereInvitation, select: { receiverId: true } });
    const invitedUserIds = acceptedInvitations.map((i) => i.receiverId).filter(Boolean) as string[];
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== role) throw new BadRequestException(`Only users with role '${role}' can be added as ${role}`);
    const existing = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    if (existing) throw new BadRequestException('User is already a team member');
    if (userRole === UserRole.manager && role === 'manager') throw new ForbiddenException('Managers cannot add other managers');
    if (role === 'worker') {
      if (!managerId) throw new BadRequestException('managerId is required for workers');
      const manager = await this.prisma.projectMember.findFirst({ where: { projectId, userId: managerId, role: 'manager' } });
      if (!manager) throw new NotFoundException('Manager not found in this project');
    }
    const member = await this.prisma.projectMember.create({
      data: { projectId, userId, role, ...(managerId && { managerId }) },
      include: { user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true } } },
    });
    if (role === 'worker' && managerId) {
      const existingMap = await this.prisma.workerManagerMap.findFirst({ where: { workerId: userId, managerId } });
      if (!existingMap) await this.prisma.workerManagerMap.create({ data: { managerId, workerId: userId } });
    }
    return { message: `${role} added successfully`, member: { memberId: member.id, ...member.user } };
  }

  async removeTeamMember(projectId: string, userId: string, adminId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, adminId, userRole);
    const member = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    if (!member) throw new NotFoundException('Member not found');
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
    const [logs, total] = await Promise.all([
      this.prisma.locationLog.findMany({
        where: { geofence: { projectId } },
        include: {
          user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          geofence: { select: { id: true, zoneName: true } },
        },
        orderBy: { loggedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.locationLog.count({ where: { geofence: { projectId } } }),
    ]);
    return {
      data: logs.map((log) => ({
        id: log.id,
        worker: log.user,
        lat: log.lat,
        lng: log.lng,
        eventType: log.eventType,
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
}