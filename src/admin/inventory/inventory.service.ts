import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  UpdateStockDto,
  CreateDamageDto,
  UpdateDamageStatusDto,
  InventoryQueryDto,
  PaginationDto,
} from './dto/inventory.dto';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type AuthUser = {
  id: string;
  role: string;
  companyId?: string;
};

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ════════════════════════════════════════════
  // SCOPE HELPER
  // ════════════════════════════════════════════

  /**
   * Returns a Prisma `where` filter for the `project` relation
   * based on the caller's role.
   *
   * super_admin → {} (no restriction — sees everything)
   * admin       → { companyId }
   * others      → { id: { in: [...assigned project ids] } }
   */
  private async getProjectScope(user: AuthUser): Promise<Record<string, any>> {
    if (user.role === 'super_admin') return {};

    if (user.role === 'admin') {
      return { companyId: user.companyId };
    }

    const memberships = await this.prisma.projectMember.findMany({
      where:  { userId: user.id },
      select: { projectId: true },
    });
    return { id: { in: memberships.map((m) => m.projectId) } };
  }

  /**
   * Merges role scope with an optional specific projectId filter.
   */
  private mergeScope(
    scope: Record<string, any>,
    projectId?: string,
  ): Record<string, any> {
    if (projectId) return { ...scope, id: projectId };
    return scope;
  }

  // ════════════════════════════════════════════
  // PROJECT LIST  (dropdown)
  // ════════════════════════════════════════════

  async getProjectList(user: AuthUser) {
    const scope = await this.getProjectScope(user);

    return this.prisma.project.findMany({
      where:   scope,
      select:  { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  // ════════════════════════════════════════════
  // SUMMARY  (three stat cards)
  // ════════════════════════════════════════════

  /**
   * Returns:
   *  totalProducts     — total inventory items in scope
   *  lowStockAlerts    — items where currentQty <= minStockQty
   *  unresolvedDamages — damage reports with status = 'unresolved'
   */
  async getSummary(user: AuthUser, projectId?: string) {
    const scope        = await this.getProjectScope(user);
    const projectWhere = this.mergeScope(scope, projectId);

    const [allItems, damages] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where:  { project: projectWhere },
        select: { currentQty: true, minStockQty: true },
      }),
      this.prisma.inventoryDamage.count({
        where: {
          status:    'unresolved',
          inventory: { project: projectWhere },
        },
      }),
    ]);

    const totalProducts     = allItems.length;
    const lowStockAlerts    = allItems.filter(
      (i) => i.currentQty <= i.minStockQty,
    ).length;
    const unresolvedDamages = damages;

    return { totalProducts, lowStockAlerts, unresolvedDamages };
  }

  // ════════════════════════════════════════════
  // STOCK LIST  (main paginated table)
  // ════════════════════════════════════════════

  /**
   * Paginated inventory list — "Stock List" tab.
   *
   * Each row:
   *   name, category, currentQty, unit, minStockQty (threshold),
   *   stockStatus, project { id, name }, unresolvedDamages count
   *
   * When lowStock=true → only low-stock rows are returned.
   */
  async getInventoryItems(user: AuthUser, query: InventoryQueryDto) {
    const {
      projectId,
      search,
      category,
      location,
      lowStock,
      page  = 1,
      limit = 20,
    } = query;

    const skip       = (page - 1) * limit;
    const isLowStock = lowStock === true || (lowStock as any) === 'true';

    const scope        = await this.getProjectScope(user);
    const projectWhere = this.mergeScope(scope, projectId);

    // Build search / filter where
    const where: any = { project: projectWhere };
    if (search)   where.name     = { contains: search,   mode: 'insensitive' };
    if (category) where.category = { contains: category, mode: 'insensitive' };
    if (location) where.location = { contains: location, mode: 'insensitive' };

    // Fetch all matching items (needed for correct lowStock pagination)
    const allItems = await this.prisma.inventoryItem.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        project: { select: { id: true, name: true } },
        damages: {
          where:  { status: 'unresolved' },
          select: { id: true },
        },
      },
    });

    // Apply lowStock filter in JS (Prisma cannot compare two columns directly)
    const source = isLowStock
      ? allItems.filter((i) => i.currentQty <= i.minStockQty)
      : allItems;

    const total     = source.length;
    const paginated = source.slice(skip, skip + limit);

    const data = paginated.map((item) => ({
      id:               item.id,
      name:             item.name,
      category:         item.category,
      currentQty:       item.currentQty,
      unit:             item.unit,
      minStockQty:      item.minStockQty,   // "Threshold" column
      stockStatus:      this.stockStatus(item.currentQty, item.minStockQty),
      location:         item.location,
      unresolvedDamages: item.damages.length,
      project:          item.project,
      updatedAt:        item.updatedAt,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ════════════════════════════════════════════
  // LOW STOCK ALERTS  (mobile banner)
  // ════════════════════════════════════════════

  async getLowStockAlerts(user: AuthUser, projectId?: string) {
    const scope        = await this.getProjectScope(user);
    const projectWhere = this.mergeScope(scope, projectId);

    const items = await this.prisma.inventoryItem.findMany({
      where:   { project: projectWhere },
      orderBy: { currentQty: 'asc' },
      include: { project: { select: { id: true, name: true } } },
    });

    return items
      .filter((item) => item.currentQty <= item.minStockQty)
      .map((item) => ({
        id:          item.id,
        name:        item.name,
        category:    item.category,
        unit:        item.unit,
        location:    item.location,
        currentQty:  item.currentQty,
        minStockQty: item.minStockQty,
        shortage:    item.minStockQty - item.currentQty,
        stockStatus: this.stockStatus(item.currentQty, item.minStockQty),
        project:     item.project,
        updatedAt:   item.updatedAt,
      }));
  }

  // ════════════════════════════════════════════
  // USAGE HISTORY  (tab)
  // ════════════════════════════════════════════

  async getUsageHistory(user: AuthUser, query: PaginationDto) {
    const { projectId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const scope        = await this.getProjectScope(user);
    const projectWhere = this.mergeScope(scope, projectId);

    const [logs, total] = await Promise.all([
      this.prisma.inventoryUsageLog.findMany({
        where: {
          inventory: { project: projectWhere },
        },
        orderBy: { loggedAt: 'desc' },
        skip,
        take: limit,
        include: {
          inventory: {
            select: {
              id:      true,
              name:    true,
              unit:    true,
              project: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.inventoryUsageLog.count({
        where: { inventory: { project: projectWhere } },
      }),
    ]);

    return {
      data: logs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ════════════════════════════════════════════
  // DAMAGE REPORTS  (tab)
  // ════════════════════════════════════════════

  async getDamageReports(user: AuthUser, query: PaginationDto) {
    const { projectId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const scope        = await this.getProjectScope(user);
    const projectWhere = this.mergeScope(scope, projectId);

    const [damages, total] = await Promise.all([
      this.prisma.inventoryDamage.findMany({
        where:   { inventory: { project: projectWhere } },
        orderBy: { reportedAt: 'desc' },
        skip,
        take: limit,
        include: {
          inventory: {
            select: {
              id:      true,
              name:    true,
              category: true,
              project: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.inventoryDamage.count({
        where: { inventory: { project: projectWhere } },
      }),
    ]);

    return {
      data: damages,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ════════════════════════════════════════════
  // SINGLE ITEM
  // ════════════════════════════════════════════

  async getItemById(id: string, projectId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, projectId },
      include: {
        project:  { select: { id: true, name: true } },
        damages:  { orderBy: { reportedAt: 'desc' } },
        usageHistory: {
          orderBy: { loggedAt: 'desc' },
          take:    10,
        },
      },
    });

    if (!item) throw new NotFoundException('Inventory item not found');

    return {
      ...item,
      stockStatus: this.stockStatus(item.currentQty, item.minStockQty),
    };
  }

  // ════════════════════════════════════════════
  // CREATE / UPDATE / DELETE
  // ════════════════════════════════════════════

  async createItem(dto: CreateInventoryItemDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) throw new NotFoundException('Project not found'); 

    return this.prisma.inventoryItem.create({
      data: {
        projectId:   dto.projectId,
        name:        dto.name,
        category:    dto.category,
        location:    dto.location,
        currentQty:  dto.currentQty  ?? 0,
        minStockQty: dto.minStockQty ?? 0,
        unit:        dto.unit,
      },
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async updateItem(id: string, projectId: string, dto: UpdateInventoryItemDto) {
    await this.findOrFail(id, projectId);

    return this.prisma.inventoryItem.update({
      where: { id },
      data: {
        name:        dto.name,
        category:    dto.category,
        location:    dto.location,
        currentQty:  dto.currentQty,
        minStockQty: dto.minStockQty,
        unit:        dto.unit,
      },
    });
  }

  async deleteItem(id: string, projectId: string) {
    await this.findOrFail(id, projectId);
    await this.prisma.inventoryItem.delete({ where: { id } });
    return { message: 'Inventory item deleted successfully' };
  }

  // ════════════════════════════════════════════
  // STOCK UPDATE  ("Usage" button)
  // ════════════════════════════════════════════

  async updateStock(
    id: string,
    projectId: string,
    userId: string,
    dto: UpdateStockDto,
  ) {
    const item   = await this.findOrFail(id, projectId);
    const newQty = item.currentQty + dto.quantity;

    if (newQty < 0) {
      throw new ForbiddenException(
        `Insufficient stock. Current: ${item.currentQty}, Requested: ${Math.abs(dto.quantity)}`,
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.inventoryItem.update({
        where: { id },
        data:  { currentQty: newQty },
      }),
      this.prisma.inventoryUsageLog.create({
        data: {
          inventoryId: id,
          userId,
          projectId,
          qtyChange: dto.quantity,
          reason:    dto.reason ?? null,
        },
      }),
    ]);

    return {
      ...updated,
      stockStatus: this.stockStatus(updated.currentQty, updated.minStockQty),
    };
  }

  // ════════════════════════════════════════════
  // DAMAGE REPORT  ("Damage" button)
  // ════════════════════════════════════════════

  async reportDamage(userId: string, dto: CreateDamageDto) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: dto.inventoryId },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    return this.prisma.inventoryDamage.create({
      data: {
        inventoryId: dto.inventoryId,
        reportedBy:  userId,
        description: dto.description,
        qtyDamaged:  dto.qtyDamaged,
        photoUrl:    dto.photoUrl,
        status:      'unresolved',
      },
      include: {
        inventory: {
          select: {
            name:    true,
            project: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async updateDamageStatus(damageId: string, dto: UpdateDamageStatusDto) {
    const damage = await this.prisma.inventoryDamage.findUnique({
      where: { id: damageId },
    });
    if (!damage) throw new NotFoundException('Damage report not found');

    return this.prisma.inventoryDamage.update({
      where: { id: damageId },
      data: {
        status:     dto.status,
        resolvedAt: dto.status === 'resolved' ? new Date() : null,
      },
    });
  }

  // ════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════

  private async findOrFail(id: string, projectId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, projectId },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  private stockStatus(currentQty: number, minStockQty: number): string {
    if (currentQty === 0)                return 'OUT_OF_STOCK';
    if (currentQty <= minStockQty * 0.5) return 'CRITICAL';
    if (currentQty <= minStockQty)       return 'LOW_STOCK';
    return 'IN_STOCK';
  }
}