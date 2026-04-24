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
  AddRoomDto,
  AddProjectMemberDto,
  CreateGeofenceDto,
} from './dto/project.dto';

@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService) {}

  private async verifyProjectAccess(projectId: string, adminId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { company: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.company.ownerId !== adminId)
      throw new ForbiddenException('You do not have access to this project');
    return project;
  }

  async getMyProjects(adminId: string, status?: string) {
    const myCompanies = await this.prisma.company.findMany({
      where: { ownerId: adminId, isActive: true },
      select: { id: true },
    });
    const companyIds = myCompanies.map((c) => c.id);

    return this.prisma.project.findMany({
      where: {
        companyId: { in: companyIds },
        ...(status && { status: status as any }),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        progress: true,
        startDate: true,
        endDate: true,
        budget: true,
        location: true,
        numFloors: true,
        roomsPerFloor: true,
        company: { select: { id: true, name: true } },
        _count: { select: { floors: true, tasks: true, teamMembers: true } },
        teamMembers: {
          take: 4,
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
      },
    });
  }

  async createProject(dto: CreateProjectDto, adminId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, ownerId: adminId },
    });
    if (!company) throw new ForbiddenException('Company not found or not yours');

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

    return this.getProjectDetails(project.id, adminId);
  }

  async getProjectDetails(projectId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);

    return this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        company: { select: { id: true, name: true, logoUrl: true } },
        floors: {
          orderBy: { floorNumber: 'asc' },
          include: {
            rooms: {
              orderBy: { name: 'asc' },
              select: {
                id: true,
                name: true,
                type: true,
                sizeSqft: true,
                status: true,
                progress: true,
                _count: { select: { tasks: true } },
              },
            },
            _count: { select: { tasks: true, rooms: true } },
          },
        },
        teamMembers: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        },
        geofences: true,
        _count: { select: { tasks: true, documents: true, teamMembers: true } },
      },
    });
  }

  async getProjectAnalysis(projectId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        floors: { include: { rooms: true }, orderBy: { floorNumber: 'asc' } },
        expenses: { select: { amount: true, status: true } },
        tasks: { select: { status: true, estimatedHours: true, actualHours: true } },
      },
    });

    if (!project) throw new NotFoundException('Project not found');

    const totalBudget = project.budget ?? 0;
    const spent = project.expenses
      .filter((e) => e.status === 'approved')
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      project: { id: project.id, name: project.name, status: project.status, progress: project.progress, startDate: project.startDate, endDate: project.endDate },
      budget: { total: totalBudget, spent, remaining: totalBudget - spent, usedPercent: totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0 },
      tasks: {
        total: project.tasks.length,
        completed: project.tasks.filter((t) => t.status === 'completed').length,
        inProgress: project.tasks.filter((t) => t.status === 'in_progress').length,
        pending: project.tasks.filter((t) => t.status === 'pending').length,
      },
      floors: project.floors.map((f) => ({
        id: f.id, name: f.name, floorNumber: f.floorNumber, status: f.status, progress: f.progress,
        totalRooms: f.rooms.length,
        completedRooms: f.rooms.filter((r) => r.status === 'completed').length,
      })),
    };
  }

  async updateProject(projectId: string, dto: UpdateProjectDto, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  async deleteProject(projectId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    await this.prisma.project.delete({ where: { id: projectId } });
    return { message: 'Project deleted successfully' };
  }

  async addFloor(projectId: string, dto: AddFloorDto, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    const floor = await this.prisma.floor.create({
      data: { projectId, name: dto.name, floorNumber: dto.floorNumber, status: 'pending' },
    });
    if (dto.rooms && dto.rooms.length > 0) {
      await this.prisma.room.createMany({
        data: dto.rooms.map((r) => ({ floorId: floor.id, name: r.name, type: r.type, sizeSqft: r.sizeSqft, status: 'pending' as const })),
      });
    }
    return this.prisma.floor.findUnique({ where: { id: floor.id }, include: { rooms: true } });
  }

  async deleteFloor(projectId: string, floorId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, projectId } });
    if (!floor) throw new NotFoundException('Floor not found');
    await this.prisma.floor.delete({ where: { id: floorId } });
    return { message: 'Floor deleted successfully' };
  }

  async addRoom(projectId: string, floorId: string, dto: AddRoomDto, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, projectId } });
    if (!floor) throw new NotFoundException('Floor not found');
    return this.prisma.room.create({
      data: { floorId, name: dto.name, type: dto.type, sizeSqft: dto.sizeSqft, status: 'pending' },
    });
  }

  async deleteRoom(projectId: string, roomId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    const room = await this.prisma.room.findFirst({ where: { id: roomId, floor: { projectId } } });
    if (!room) throw new NotFoundException('Room not found');
    await this.prisma.room.delete({ where: { id: roomId } });
    return { message: 'Room deleted successfully' };
  }

  async getTeamMembers(projectId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    return this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true, status: true } },
      },
    });
  }

  async addTeamMember(projectId: string, dto: AddProjectMemberDto, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('User not found');
    const existing = await this.prisma.projectMember.findFirst({ where: { projectId, userId: dto.userId } });
    if (existing) throw new BadRequestException('User is already a team member');
    return this.prisma.projectMember.create({
      data: { projectId, userId: dto.userId, role: dto.role },
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
      },
    });
  }

  async removeTeamMember(projectId: string, userId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    const member = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    if (!member) throw new NotFoundException('Member not found');
    await this.prisma.projectMember.delete({ where: { id: member.id } });
    return { message: 'Member removed successfully' };
  }

  async getGeofences(projectId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    return this.prisma.geofence.findMany({ where: { projectId } });
  }

  async createGeofence(projectId: string, dto: CreateGeofenceDto, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    return this.prisma.geofence.create({
      data: { projectId, zoneName: dto.zoneName, centerLat: dto.centerLat, centerLng: dto.centerLng, radiusMeters: dto.radiusMeters, polygonCoords: dto.polygonCoords, totalAreaSqft: dto.totalAreaSqft, perimeterFt: dto.perimeterFt, isActive: true },
    });
  }

  async updateGeofence(projectId: string, geofenceId: string, dto: Partial<CreateGeofenceDto> & { isActive?: boolean }, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    const geo = await this.prisma.geofence.findFirst({ where: { id: geofenceId, projectId } });
    if (!geo) throw new NotFoundException('Geofence not found');
    return this.prisma.geofence.update({ where: { id: geofenceId }, data: dto });
  }

  async deleteGeofence(projectId: string, geofenceId: string, adminId: string) {
    await this.verifyProjectAccess(projectId, adminId);
    const geo = await this.prisma.geofence.findFirst({ where: { id: geofenceId, projectId } });
    if (!geo) throw new NotFoundException('Geofence not found');
    await this.prisma.geofence.delete({ where: { id: geofenceId } });
    return { message: 'Geofence deleted successfully' };
  }

}