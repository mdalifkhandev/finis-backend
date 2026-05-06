import {
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, UserStatus } from '../../generated/prisma/client';



@Injectable()
export class TeamManagementService {
  constructor(private prisma: PrismaService) {}

  // ── IMAGE 1: Admin Stats ─────────────────────────────────────────────
  async getAdminStats(userId: string, userRole: string) {
    const isSuperAdmin = userRole === UserRole.super_admin;

    // Total Admins
    const totalAdmins = await this.prisma.user.count({
      where: { role: UserRole.admin },
    });

    // Active admins
    const activeAdmins = await this.prisma.user.count({
      where: { role: UserRole.admin, status: UserStatus.active },
    });


    const pendingApproval = await this.prisma.user.count({
      where: { role: UserRole.admin, status: UserStatus.pending },
    });

    // Pending Invitations — admin role এ invitation পাঠানো হয়েছে কিন্তু accept হয়নি
    const pendingInvitations = await this.prisma.invitation.count({
      where: {
        role: UserRole.admin,
        status: 'pending',
        ...(isSuperAdmin ? {} : { senderId: userId }),
      },
    });

    return {
      totalAdmins,
      active: activeAdmins,
      pendingApproval,
      pendingInvitations,
    };
  }

  // ── IMAGE 2: Manager Stats ───────────────────────────────────────────
  async getManagerStats(userId: string, userRole: string) {
    const isSuperAdmin = userRole === UserRole.super_admin;

    // Total Managers
    const totalManagers = await this.prisma.user.count({
      where: { role: UserRole.manager },
    });

    // Active Managers
    const activeManagers = await this.prisma.user.count({
      where: { role: UserRole.manager, status: UserStatus.active },
    });

    // Total Projects Managed — ProjectMember তে role=manager এ unique projectId count
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

  // ── IMAGE 3: Workforce Stats ─────────────────────────────────────────
  async getWorkforceStats(userId: string, userRole: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    lastMonth.setHours(0, 0, 0, 0);

    // Total Workforce — role=worker সব active user
    const totalWorkforce = await this.prisma.user.count({
      where: { role: UserRole.worker, status: UserStatus.active },
    });

    // Last month workforce (trend এর জন্য)
    const lastMonthWorkforce = await this.prisma.user.count({
      where: {
        role: UserRole.worker,
        status: UserStatus.active,
        createdAt: { lt: lastMonth },
      },
    });
    const workforceTrend = totalWorkforce - lastMonthWorkforce; // +12 এর মতো

    // Active Today — আজকে attendance আছে এমন worker
    const activeToday = await this.prisma.attendance.count({
      where: {
        date: { gte: today, lte: todayEnd },
        user: { role: UserRole.worker },
      },
    });

    const activeTodayPercent =
      totalWorkforce > 0 ? Math.round((activeToday / totalWorkforce) * 100) : 0;

    // On Leave — আজকে approved leave আছে এমন worker
    const onLeave = await this.prisma.leaveRequest.count({
      where: {
        status: 'approved',
        startDate: { lte: todayEnd },
        endDate: { gte: today },
      },
    });

    // Last week on leave (trend এর জন্য)
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const onLeaveLastWeek = await this.prisma.leaveRequest.count({
      where: {
        status: 'approved',
        startDate: { lte: new Date(lastWeek.getTime() + 86400000) },
        endDate: { gte: lastWeek },
      },
    });
    const leaveTrend = onLeave - onLeaveLastWeek; // -2 এর মতো

    // Avg Attendance — last 30 দিনের attendance rate
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

    // Last month avg attendance (trend এর জন্য)
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
    const attendanceTrend = Math.round((avgAttendance - prevAvgAttendance) * 10) / 10; // +1.2 এর মতো

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
}