import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, UserStatus } from '../../generated/prisma/client';

@Injectable()
export class TeamManagementService {
  constructor(private prisma: PrismaService) {}

  // ── Admin Stats ──────────────────────────────────────────────────────
async getAdminStats(userId: string, userRole: string) {
  const totalAdmins = await this.prisma.user.count({
    where: { role: UserRole.admin },
  });

  const activeAdmins = await this.prisma.user.count({
    where: { role: UserRole.admin, status: UserStatus.active },
  });

  const pendingInvitations = await this.prisma.invitation.count({
    where: { status: 'pending', role: UserRole.admin },
  });

  return {
    totalAdmins,
    active: activeAdmins,
    pendingInvitations,
  };
}
  // ── Admin List (super_admin বাদ) ─────────────────────────────────────
  async getAdminList(search?: string, status?: string) {
    return this.prisma.user.findMany({
      where: {
        role: UserRole.admin, // শুধু admin, super_admin বাদ
        ...(status && status !== 'all' ? { status: status as any } : {}),
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        avatarUrl: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // User Details by ID
  async getUserDetailsById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        employeeId: true,
        department: true,
        dateOfBirth: true,
        address: true,
        bio: true,
        hourlyRate: true,
        joinDate: true,
        avatarUrl: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        projectMemberships: {
          select: {
            id: true,
            role: true,
            managerId: true,
            createdAt: true,
            project: {
              select: {
                id: true,
                name: true,
                status: true,
                startDate: true,
                endDate: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        certifications: {
          select: {
            id: true,
            name: true,
            issuedBy: true,
            issuedAt: true,
            expiresAt: true,
            status: true,
            documentUrl: true,
          },
        },
        userSettings: {
          select: {
            language: true,
            timezone: true,
            dateFormat: true,
            currency: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  // ── Update User Status ───────────────────────────────────────────────
  async updateUserStatus(userId: string, status: string) {
    const validStatuses = ['active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException('Invalid status');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { status: status as any },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
      },
    });
  }

  // ── Manager Stats ────────────────────────────────────────────────────
  async getManagerStats(userId: string, userRole: string) {
    const totalManagers = await this.prisma.user.count({
      where: { role: UserRole.manager },
    });

    const activeManagers = await this.prisma.user.count({
      where: { role: UserRole.manager, status: UserStatus.active },
    });

    const managedProjects = await this.prisma.projectMember.findMany({
      where: { role: 'manager' },
      select: { projectId: true },
      distinct: ['projectId'],
    });

    return {
      totalManagers,
      active: activeManagers,
      totalProjectsManaged: managedProjects.length,
    };
  }

  // ── Workforce Stats ──────────────────────────────────────────────────
  async getWorkforceStats(userId: string, userRole: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    lastMonth.setHours(0, 0, 0, 0);

    const totalWorkforce = await this.prisma.user.count({
      where: { role: UserRole.worker, status: UserStatus.active },
    });

    const lastMonthWorkforce = await this.prisma.user.count({
      where: {
        role: UserRole.worker,
        status: UserStatus.active,
        createdAt: { lt: lastMonth },
      },
    });
    const workforceTrend = totalWorkforce - lastMonthWorkforce;

    const activeToday = await this.prisma.attendance.count({
      where: {
        date: { gte: today, lte: todayEnd },
        user: { role: UserRole.worker },
      },
    });

    const activeTodayPercent =
      totalWorkforce > 0 ? Math.round((activeToday / totalWorkforce) * 100) : 0;

    const onLeave = await this.prisma.leaveRequest.count({
      where: {
        status: 'approved',
        startDate: { lte: todayEnd },
        endDate: { gte: today },
      },
    });

    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const onLeaveLastWeek = await this.prisma.leaveRequest.count({
      where: {
        status: 'approved',
        startDate: { lte: new Date(lastWeek.getTime() + 86400000) },
        endDate: { gte: lastWeek },
      },
    });
    const leaveTrend = onLeave - onLeaveLastWeek;

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const totalAttendances = await this.prisma.attendance.count({
      where: {
        date: { gte: last30Days },
        user: { role: UserRole.worker },
      },
    });

    const totalExpectedAttendances = totalWorkforce * 30;
    const avgAttendance =
      totalExpectedAttendances > 0
        ? Math.round((totalAttendances / totalExpectedAttendances) * 1000) / 10
        : 0;

    const prevMonthAttendances = await this.prisma.attendance.count({
      where: {
        date: { gte: lastMonth, lt: last30Days },
        user: { role: UserRole.worker },
      },
    });
    const prevAvgAttendance =
      totalExpectedAttendances > 0
        ? Math.round((prevMonthAttendances / totalExpectedAttendances) * 1000) / 10
        : 0;
    const attendanceTrend = Math.round((avgAttendance - prevAvgAttendance) * 10) / 10;

    return {
      totalWorkforce,
      workforceTrend: workforceTrend >= 0 ? `+${workforceTrend}` : `${workforceTrend}`,
      activeToday,
      activeTodayPercent: `${activeTodayPercent}%`,
      onLeave,
      leaveTrend: leaveTrend >= 0 ? `+${leaveTrend}` : `${leaveTrend}`,
      avgAttendance: `${avgAttendance}%`,
      attendanceTrend: attendanceTrend >= 0 ? `+${attendanceTrend}%` : `${attendanceTrend}%`,
    };
  }

  // ── Pending Invitations List ─────────────────────────────────────────
async getPendingInvitations(
  userId: string,
  userRole: string,
  search?: string,
  role?: string,
) {
  // শুধু super_admin সব দেখবে
  if (userRole !== UserRole.super_admin) {
    return [];
  }

  const invitations = await this.prisma.invitation.findMany({
    where: {
      status: 'pending',
      ...(role ? { role: role as UserRole } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      sender: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    phone: inv.phone,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    requestedBy: inv.sender,
  }));
}
}
