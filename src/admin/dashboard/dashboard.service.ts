import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getAdminDashboard(adminId: string) {
    // Get all companies owned by this admin
    const myCompanies = await this.prisma.company.findMany({
      where: { ownerId: adminId, isActive: true },
      select: { id: true },
    });
    const companyIds = myCompanies.map((c) => c.id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      activeProjectsCount,
      workersOnSiteCount,
      payrollPendingCount,
      inventoryAlertsCount,
      activeProjects,
      workersOnSite,
      pendingInvitations,
    ] = await Promise.all([
      // Active projects count
      this.prisma.project.count({
        where: { companyId: { in: companyIds }, status: 'active' },
      }),

      // Workers on site (checked in today, not checked out)
      this.prisma.attendance.count({
        where: {
          date: today,
          status: 'present',
          checkInTime: { not: null },
          checkOutTime: null,
          user: { companyMembers: { some: { companyId: { in: companyIds } } } },
        },
      }),

      // Payroll pending (draft status)
      this.prisma.payroll.count({
        where: { companyId: { in: companyIds }, status: 'draft' },
      }),

      // Inventory alerts (below min stock)
      this.prisma.inventoryItem.count({
        where: {
          companyId: { in: companyIds },
          currentQty: { lte: this.prisma.inventoryItem.fields.minStockQty },
        },
      }).catch(() =>
        // fallback raw count
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count FROM inventory_items
          WHERE company_id = ANY(${companyIds}::uuid[])
          AND current_qty <= min_stock_qty
        `.then((r) => Number(r[0]?.count ?? 0)),
      ),

      // Active projects list (up to 10)
      this.prisma.project.findMany({
        where: { companyId: { in: companyIds }, status: 'active' },
        take: 10,
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

      // Workers on site list (up to 10)
      this.prisma.attendance.findMany({
        where: {
          date: today,
          status: 'present',
          checkInTime: { not: null },
          checkOutTime: null,
          user: { companyMembers: { some: { companyId: { in: companyIds } } } },
        },
        take: 10,
        select: {
          checkInTime: true,
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              role: true,
              companyMembers: {
                where: { companyId: { in: companyIds } },
                select: { role: true },
                take: 1,
              },
            },
          },
        },
      }),

      // Pending invitations sent by this admin
      this.prisma.invitation.findMany({
        where: { senderId: adminId, status: 'pending' },
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
        inventoryAlerts: typeof inventoryAlertsCount === 'number' ? inventoryAlertsCount : 0,
      },
      activeProjects: activeProjects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        progress: p.progress ?? 0,
        endDate: p.endDate,
        companyName: p.company.name,
        teamCount: p._count.teamMembers,
      })),
      workersOnSite: workersOnSite.map((a) => ({
        id: a.user.id,
        fullName: a.user.fullName,
        avatarUrl: a.user.avatarUrl,
        role: a.user.companyMembers[0]?.role ?? a.user.role,
        checkInTime: a.checkInTime,
      })),
      pendingInvitations,
    };
  }
}