import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardQueryDto } from './dto/dashboard.dto';
import { Prisma, ProjectStatus, UserRole } from '../../generated/prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getAdminDashboard(adminId: string, userRole: string, query: DashboardQueryDto) {
    const {
      projectsPage = 1,
      projectsLimit = 10,
      workersPage = 1,
      workersLimit = 10,
      invitationsPage = 1,
      invitationsLimit = 10,
    } = query;

    const myCompanies = userRole === UserRole.admin
      ? await this.prisma.company.findMany({
          where: { ownerId: adminId, isActive: true },
          select: { id: true },
        })
      : [];
    const companyIds = myCompanies.map((c) => c.id);

    const projectWhere: Prisma.ProjectWhereInput =
      userRole === UserRole.manager
        ? {
            teamMembers: {
              some: {
                userId: adminId,
                role: 'manager',
              },
            },
          }
        : {
            companyId: { in: companyIds },
          };

    const workerWhere: Prisma.UserWhereInput =
      userRole === UserRole.manager
        ? {
            projectMemberships: {
              some: {
                managerId: adminId,
              },
            },
          }
        : {
            companyMembers: { some: { companyId: { in: companyIds } } },
          };

    const today = new Date();
    today.setHours(0, 0, 0, 0);



    const activeProjectQuery: Prisma.ProjectWhereInput = {
      ...projectWhere,
      status: ProjectStatus.active,
    };

    const attendanceUserWhere: Prisma.UserWhereInput =
      userRole === UserRole.manager
        ? {
            projectMemberships: {
              some: {
                project: {
                  teamMembers: {
                    some: {
                      userId: adminId,
                      role: 'manager',
                    },
                  },
                },
              },
            },
          }
        : {
            OR: [
              { companyMembers: { some: { companyId: { in: companyIds } } } },
              {
                projectMemberships: {
                  some: {
                    project: { companyId: { in: companyIds } },
                  },
                },
              },
            ],
          };

    const attendanceWhere2 = {
      date: today,
      status: 'present',
      sessions: {
        some: {
          checkInTime: { not: undefined },
          checkOutTime: null,
        },
      },
      user: attendanceUserWhere,
    };

    const inventoryAlertsQuery =
      userRole === UserRole.manager
        ? this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) as count FROM inventory_items
            WHERE project_id IN (
              SELECT id FROM projects
              WHERE id IN (
                SELECT project_id FROM project_members
                WHERE user_id = ${adminId} AND role = 'manager'
              )
            )
            AND current_qty <= min_stock_qty
          `.then((r) => Number(r[0]?.count ?? 0))
        : this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) as count FROM inventory_items
            WHERE project_id IN (
              SELECT id FROM projects
              WHERE company_id = ANY(${companyIds}::uuid[])
            )
            AND current_qty <= min_stock_qty
          `.then((r) => Number(r[0]?.count ?? 0));

      const [
      activeProjectsCount,
      workersOnSiteCount,
      payrollPendingCount,
      inventoryAlertsCount,
      totalProjects,
      activeProjects,
      totalWorkersOnSite,
      workersOnSite,
      totalInvitations,
      pendingInvitations,
    ] = await Promise.all([
      // ── Stats ──────────────────────────────────────
      this.prisma.project.count({
        where: activeProjectQuery,
      }),

      this.prisma.attendance.count({ where: attendanceWhere2 }),

      this.prisma.payroll.count({
        where:
          userRole === UserRole.manager
            ? { status: 'draft' }
            : { companyId: { in: companyIds }, status: 'draft' },
      }),

      inventoryAlertsQuery,

      // ── Active Projects (paginated) ────────────────
      this.prisma.project.count({
        where: activeProjectQuery,
      }),

      this.prisma.project.findMany({
        where: activeProjectQuery,
        skip: (projectsPage - 1) * projectsLimit,
        take: projectsLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          progress: true,
          endDate: true,
          company: { select: { name: true } },
          _count: { select: { teamMembers: true } },
        },
      }),

      // ── Workers On Site (paginated) ────────────────
      this.prisma.attendance.count({ where: attendanceWhere2 }),

      this.prisma.attendance.findMany({
        where: attendanceWhere2,
        skip: (workersPage - 1) * workersLimit,
        take: workersLimit,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              role: true,
              companyMembers: {
                where:
                  userRole === UserRole.manager
                    ? {}
                    : { companyId: { in: companyIds } },
                select: { role: true },
                take: 1,
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

      // ── Pending Invitations (paginated) ────────────
      this.prisma.invitation.count({
        where: { senderId: adminId, status: 'pending' },
      }),

      this.prisma.invitation.findMany({
        where: { senderId: adminId, status: 'pending' },
        skip: (invitationsPage - 1) * invitationsLimit,
        take: invitationsLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      stats: {
        activeProjects: activeProjectsCount,
        workersOnSite: workersOnSiteCount,
        payrollPending: payrollPendingCount,
        inventoryAlerts: inventoryAlertsCount,
      },

      activeProjects: {
        data: activeProjects.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          progress: p.progress ?? 0,
          endDate: p.endDate,
          companyName: p.company.name,
          teamCount: p._count.teamMembers,
        })),
        meta: {
          total: totalProjects,
          page: projectsPage,
          limit: projectsLimit,
          totalPages: Math.ceil(totalProjects / projectsLimit),
        },
      },

      workersOnSite: {
        data: workersOnSite.map((a) => ({
          id: a.user.id,
          fullName: a.user.fullName,
          avatarUrl: a.user.avatarUrl,
          role: a.user.companyMembers?.[0]?.role ?? a.user.role,
          checkInTime: a.sessions[0]?.checkInTime ?? null,
        })),
        meta: {
          total: totalWorkersOnSite,
          page: workersPage,
          limit: workersLimit,
          totalPages: Math.ceil(totalWorkersOnSite / workersLimit),
        },
      },

      pendingInvitations: {
        data: pendingInvitations,
        meta: {
          total: totalInvitations,
          page: invitationsPage,
          limit: invitationsLimit,
          totalPages: Math.ceil(totalInvitations / invitationsLimit),
        },
      },
    };
  }
}