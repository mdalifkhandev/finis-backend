import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SuperAdminDashboardQueryDto } from './dto/dashboard.dto';

@Injectable()
export class SuperAdminDashboardService {
  constructor(private prisma: PrismaService) {}

  // ─── Date range helper ────────────────────────────────────────────────────
  private getDateRange(query: SuperAdminDashboardQueryDto): {
    start: Date;
    end: Date;
    prevStart: Date;
    prevEnd: Date;
  } {
    const now = new Date();
    let start: Date;
    let end: Date = new Date(now);
    end.setHours(23, 59, 59, 999);

    switch (query.period) {
      case 'today':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        start = new Date(now);
        start.setDate(now.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'yearly':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case 'custom':
        start = query.startDate
          ? new Date(query.startDate)
          : new Date(now.getFullYear(), now.getMonth(), 1);
        end = query.endDate ? new Date(query.endDate) : end;
        end.setHours(23, 59, 59, 999);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const duration = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - duration);

    return { start, end, prevStart, prevEnd };
  }

  // ─── Change % helper ─────────────────────────────────────────────────────
  private calcChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100 * 10) / 10;
  }

  // ─── MAIN DASHBOARD ───────────────────────────────────────────────────────
  async getSuperAdminDashboard(query: SuperAdminDashboardQueryDto) {
    const { start, end, prevStart, prevEnd } = this.getDateRange(query);

    // ─── Stat Cards ────────────────────────────────────────────────────────
    const [
      activeCompanies,
      activeProjects,
      totalWorkforce,
      payrollCostRaw,
      attendancePresent,
      attendanceTotal,
      geofenceViolations,
      totalGeofenceChecks,
      prevActiveCompanies,
      prevActiveProjects,
      prevTotalWorkforce,
      prevPayrollCostRaw,
    ] = await Promise.all([
      this.prisma.company.count({
        where: { isActive: true, createdAt: { lte: end } },
      }),
      this.prisma.project.count({
        where: { status: 'active' },
      }),
      this.prisma.user.count({
        where: { role: 'worker', status: 'active' },
      }),
      this.prisma.payroll.aggregate({
        _sum: { netPay: true },
        where: { status: 'approved', createdAt: { gte: start, lte: end } },
      }),
      this.prisma.attendance.count({
        where: { date: { gte: start, lte: end }, status: 'present' },
      }),
      this.prisma.attendance.count({
        where: { date: { gte: start, lte: end } },
      }),
      this.prisma.geofenceViolation.count({
        where: { isResolved: false, occurredAt: { gte: start, lte: end } },
      }),
      this.prisma.geofenceViolation.count({
        where: { occurredAt: { gte: start, lte: end } },
      }),
      this.prisma.company.count({
        where: { isActive: true, createdAt: { lte: prevEnd } },
      }),
      this.prisma.project.count({
        where: { status: 'active', createdAt: { lte: prevEnd } },
      }),
      this.prisma.user.count({
        where: { role: 'worker', status: 'active', createdAt: { lte: prevEnd } },
      }),
      this.prisma.payroll.aggregate({
        _sum: { netPay: true },
        where: {
          status: 'approved',
          createdAt: { gte: prevStart, lte: prevEnd },
        },
      }),
    ]);

    const payrollCost = Number(payrollCostRaw._sum.netPay ?? 0);
    const prevPayrollCost = Number(prevPayrollCostRaw._sum.netPay ?? 0);

    const attendanceRate =
      attendanceTotal > 0
        ? Math.round((attendancePresent / attendanceTotal) * 1000) / 10
        : 0;

    const geofenceAlertRate =
      totalGeofenceChecks > 0
        ? Math.round((geofenceViolations / totalGeofenceChecks) * 1000) / 10
        : 0;

    // ─── Project Completion Forecast (monthly bar chart) ───────────────────
    const currentYear = new Date().getFullYear();
    const monthlyTaskData = await this.prisma.$queryRaw<
      { month: number; total: bigint; completed: bigint }[]
    >`
      SELECT
        EXTRACT(MONTH FROM created_at)::int AS month,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed
      FROM tasks
      WHERE created_at >= ${start} AND created_at <= ${end}
      GROUP BY month
      ORDER BY month
    `;

    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const forecastData = months.map((name, i) => {
      const m = monthlyTaskData.find((d) => d.month === i + 1);
      const total = Number(m?.total ?? 0);
      const completed = Number(m?.completed ?? 0);
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { month: name, completionPct: pct, total, completed };
    });

    const nonZero = forecastData.filter((d) => d.completionPct > 0);
    const bestMonth = nonZero.length
      ? nonZero.reduce((a, b) => (a.completionPct >= b.completionPct ? a : b))
      : null;
    const avgCompletion = nonZero.length
      ? Math.round(
          (nonZero.reduce((s, d) => s + d.completionPct, 0) / nonZero.length) * 10,
        ) / 10
      : 0;
    const overallCompletion = nonZero.length
      ? Math.round(
          (forecastData.reduce((s, d) => s + d.completionPct, 0) / nonZero.length) * 10,
        ) / 10
      : 0;

    // ─── Task Indicators ───────────────────────────────────────────────────
    const [
      totalTasks,
      activeTasks,
      pendingApprovals,
      completedTasks,
      atRiskTasks,
      prevActiveTasks,
      prevPendingApprovals,
      prevCompletedTasks,
    ] = await Promise.all([
      this.prisma.task.count({
        where: { createdAt: { gte: start, lte: end } },
      }),
      this.prisma.task.count({ where: { status: 'in_progress' } }),
      this.prisma.task.count({ where: { status: 'review' } }),
      this.prisma.task.count({
        where: { status: 'completed', updatedAt: { gte: start, lte: end } },
      }),
      this.prisma.task.count({
        where: {
          status: { notIn: ['completed', 'cancelled'] },
          dueDate: { lt: new Date() },
        },
      }),
      this.prisma.task.count({
        where: {
          status: 'in_progress',
          createdAt: { gte: prevStart, lte: prevEnd },
        },
      }),
      this.prisma.task.count({
        where: {
          status: 'review',
          createdAt: { gte: prevStart, lte: prevEnd },
        },
      }),
      this.prisma.task.count({
        where: {
          status: 'completed',
          updatedAt: { gte: prevStart, lte: prevEnd },
        },
      }),
    ]);

    const efficiency =
      totalTasks > 0
        ? Math.round((completedTasks / totalTasks) * 1000) / 10
        : 0;

    const onTimeTasks = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM tasks
      WHERE status = 'completed'
        AND due_date IS NOT NULL
        AND updated_at <= due_date
        AND updated_at >= ${start}
        AND updated_at <= ${end}
    `;
    const onTimeCount = Number(onTimeTasks[0]?.count ?? 0);
    const onTimePct =
      completedTasks > 0 ? Math.round((onTimeCount / completedTasks) * 100) : 0;

    // ─── BUILD RESPONSE ────────────────────────────────────────────────────
    return {
      period: { type: query.period ?? 'monthly', start, end },

      stats: {
        activeCompanies: {
          value: activeCompanies,
          change: this.calcChange(activeCompanies, prevActiveCompanies),
        },
        activeProjects: {
          value: activeProjects,
          change: this.calcChange(activeProjects, prevActiveProjects),
        },
        totalWorkforce: {
          value: totalWorkforce,
          change: this.calcChange(totalWorkforce, prevTotalWorkforce),
        },
        payrollCost: {
          value: payrollCost,
          change: this.calcChange(payrollCost, prevPayrollCost),
        },
      },

      indicators: {
        attendanceRate: {
          value: attendanceRate,
          presentCount: attendancePresent,
          totalCount: attendanceTotal,
        },
        geofenceAlerts: {
          value: geofenceAlertRate,
          unresolvedCount: geofenceViolations,
          totalCount: totalGeofenceChecks,
        },
      },

      projectCompletionForecast: {
        overallCompletion,
        avgCompletion,
        bestMonth: bestMonth
          ? { month: bestMonth.month, value: bestMonth.completionPct }
          : null,
        data: forecastData,
      },

      taskIndicators: {
        totalTasks,
        activeTasks: {
          value: activeTasks,
          change: this.calcChange(activeTasks, prevActiveTasks),
        },
        pendingApprovals: {
          value: pendingApprovals,
          change: this.calcChange(pendingApprovals, prevPendingApprovals),
        },
        completed: {
          value: completedTasks,
          change: this.calcChange(completedTasks, prevCompletedTasks),
        },
        efficiency,
        teamSize: totalWorkforce,
        onTimePct,
        atRisk: atRiskTasks,
      },
    };
  }

  // ─── RECENT ACTIVITY (Paginated) ──────────────────────────────────────────
  async getRecentActivity(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    // Count totals first so pagination meta is accurate
    const [totalTaskReports, totalPayrolls, totalExpenses] = await Promise.all([
      this.prisma.taskReport.count(),
      this.prisma.payroll.count({ where: { status: 'approved' } }),
      this.prisma.expense.count({ where: { status: 'pending' } }),
    ]);
    const total = totalTaskReports + totalPayrolls + totalExpenses;

    // Over-fetch all three sources up to (skip + limit) each so that
    // after merging & sorting we always have enough rows to slice correctly.
    // This is safe because the three sources are independently ordered by date.
    const fetchSize = skip + limit;

    const [taskReports, payrolls, expenses] = await Promise.all([
      this.prisma.taskReport.findMany({
        take: fetchSize,
        orderBy: { submittedAt: 'desc' },
        include: {
          worker: { select: { id: true, fullName: true, avatarUrl: true } },
          task: {
            select: {
              title: true,
              project: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.payroll.findMany({
        take: fetchSize,
        where: { status: 'approved' },
        orderBy: { processedAt: 'desc' },
        include: {
          worker: { select: { id: true, fullName: true, avatarUrl: true } },
          company: { select: { name: true } },
        },
      }),
      this.prisma.expense.findMany({
        take: fetchSize,
        where: { status: 'pending' },
        orderBy: { createdAt: 'desc' },
        include: {
          worker: { select: { id: true, fullName: true, avatarUrl: true } },
          project: { select: { name: true } },
        },
      }),
    ]);

    const unified = [
      ...taskReports.map((r) => ({
        type:
          r.reviewDecision === 'approved' ? 'task_completed' : 'report_uploaded',
        actor: r.worker,
        description:
          r.reviewDecision === 'approved' ? 'completed task' : 'uploaded report',
        subject: r.task.title,
        project: r.task.project?.name ?? null,
        occurredAt: r.submittedAt,
      })),
      ...payrolls.map((p) => ({
        type: 'payroll_approved',
        actor: p.worker,
        description: 'approved payroll',
        subject: `Week payroll - ${p.company.name}`,
        project: p.company.name,
        occurredAt: p.processedAt ?? p.createdAt,
      })),
      ...expenses.map((e) => ({
        type: 'expense_flagged',
        actor: e.worker,
        description: 'flagged expense',
        subject: e.description,
        project: e.project?.name ?? null,
        occurredAt: e.createdAt,
      })),
    ].sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    const data = unified.slice(skip, skip + limit);
    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  // ─── WORKFORCE STATUS (Paginated) ─────────────────────────────────────────
  async getWorkforceStatus(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const whereClause = {
      date: today,
      status: 'present',
      sessions: { some: { checkOutTime: null } },
    } as const;

    const [attendances, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              department: true,
              projectMemberships: {
                take: 1,
                orderBy: { createdAt: 'desc' },
                include: {
                  project: { select: { name: true } },
                },
              },
            },
          },
          sessions: {
            where: { checkOutTime: null },
            orderBy: { checkInTime: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.attendance.count({ where: whereClause }),
    ]);

    const data = attendances.map((a) => {
      const checkIn = a.sessions[0]?.checkInTime ?? null;
      let hoursWorked = 0;
      if (checkIn) {
        hoursWorked =
          (Date.now() - new Date(checkIn).getTime()) / (1000 * 60 * 60);
      }
      const h = Math.floor(hoursWorked);
      const m = Math.round((hoursWorked - h) * 60);

      const status: 'on_time' | 'overtime' =
        hoursWorked >= 8 ? 'overtime' : 'on_time';

      const membership = a.user.projectMemberships[0];

      return {
        id: a.user.id,
        fullName: a.user.fullName,
        avatarUrl: a.user.avatarUrl,
        department: a.user.department,
        projectName: membership?.project?.name ?? null,
        role: membership?.role ?? null,
        hoursWorked: `${h}h ${String(m).padStart(2, '0')}m`,
        status,
        checkInTime: checkIn,
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }
}