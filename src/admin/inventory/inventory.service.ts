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
  CreateInventoryDamageDto,
  UpdateDamageStatusDto,
  InventoryQueryDto,
} from './dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────
  // INVENTORY ITEMS
  // ─────────────────────────────────────────────

  /** Get all inventory items for a project with stats */
  async getInventoryItems(projectId: string, query: InventoryQueryDto) {
    const { search, category, location, lowStock, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = { projectId };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (category) {
      where.category = { contains: category, mode: 'insensitive' };
    }
    if (location) {
      where.location = { contains: location, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          damages: {
            where: { status: { not: 'resolved' } },
            select: { id: true, status: true, qtyDamaged: true },
          },
        },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    // If lowStock filter is active, filter items where currentQty <= minStockQty
    let filteredItems = items;
    if (lowStock === true || (lowStock as any) === 'true') {
      filteredItems = items.filter((item) => item.currentQty <= item.minStockQty);
    }

    // Attach stock status label
    const itemsWithStatus = filteredItems.map((item) => ({
      ...item,
      stockStatus: this.getStockStatus(item.currentQty, item.minStockQty),
    }));

    // Summary stats
    const allItems = await this.prisma.inventoryItem.findMany({
      where: { projectId },
      select: { currentQty: true, minStockQty: true },
    });
    const lowStockCount = allItems.filter((i) => i.currentQty <= i.minStockQty).length;

    return {
      data: itemsWithStatus,
      meta: {
        total: itemsWithStatus.length,
        page,
        limit,
        totalPages: Math.ceil(itemsWithStatus.length / limit),
        totalItems: allItems.length,
        lowStockCount,
      },
    };
  }

  /** Get single inventory item by id */
  async getInventoryItemById(id: string, projectId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, projectId },
      include: {
        usageHistory: {
          orderBy: { loggedAt: 'desc' },
          take: 10,
          include: {
            inventory: { select: { name: true } },
          },
        },
        damages: {
          orderBy: { reportedAt: 'desc' },
        },
        taskInventories: {
          include: {
            task: { select: { id: true, title: true, status: true } },
          },
        },
      },
    });

    if (!item) throw new NotFoundException('Inventory item not found');

    return {
      ...item,
      stockStatus: this.getStockStatus(item.currentQty, item.minStockQty),
    };
  }

  /** Create a new inventory item */
  async createInventoryItem(dto: CreateInventoryItemDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return this.prisma.inventoryItem.create({
      data: {
        projectId: dto.projectId,
        name: dto.name,
        category: dto.category,
        location: dto.location,
        currentQty: dto.currentQty ?? 0,
        minStockQty: dto.minStockQty ?? 0,
        unit: dto.unit,
      },
    });
  }

  /** Update inventory item details */
  async updateInventoryItem(id: string, projectId: string, dto: UpdateInventoryItemDto) {
    await this.findItemOrFail(id, projectId);

    return this.prisma.inventoryItem.update({
      where: { id },
      data: {
        name: dto.name,
        category: dto.category,
        location: dto.location,
        minStockQty: dto.minStockQty,
        unit: dto.unit,
      },
    });
  }

  /** Delete an inventory item */
  async deleteInventoryItem(id: string, projectId: string) {
    await this.findItemOrFail(id, projectId);

    await this.prisma.inventoryItem.delete({ where: { id } });
    return { message: 'Inventory item deleted successfully' };
  }

  // ─────────────────────────────────────────────
  // STOCK MANAGEMENT
  // ─────────────────────────────────────────────

  /** Update stock quantity and log usage */
  async updateStock(id: string, projectId: string, userId: string, dto: UpdateStockDto) {
    const item = await this.findItemOrFail(id, projectId);

    const newQty = item.currentQty + dto.quantity;
    if (newQty < 0) {
      throw new ForbiddenException(
        `Not enough stock. Current: ${item.currentQty}, Requested: ${Math.abs(dto.quantity)}`,
      );
    }

    const [updatedItem] = await this.prisma.$transaction([
      this.prisma.inventoryItem.update({
        where: { id },
        data: { currentQty: newQty },
      }),
      this.prisma.inventoryUsageLog.create({
        data: {
          inventoryId: id,
          userId,
          projectId,           // ✅ route থেকে আসা projectId ব্যবহার
          qtyChange: dto.quantity,
          reason: dto.reason ?? null,
        },
      }),
    ]);

    return {
      ...updatedItem,
      stockStatus: this.getStockStatus(updatedItem.currentQty, updatedItem.minStockQty),
    };
  }

  /** Get usage history for an item */
  async getUsageHistory(id: string, projectId: string) {
    await this.findItemOrFail(id, projectId);

    return this.prisma.inventoryUsageLog.findMany({
      where: { inventoryId: id },
      orderBy: { loggedAt: 'desc' },
      include: {
        inventory: { select: { name: true, unit: true } },
      },
    });
  }

  // ─────────────────────────────────────────────
  // DAMAGE REPORTS
  // ─────────────────────────────────────────────

  /** Report a damage */
  async reportDamage(userId: string, dto: CreateInventoryDamageDto) {
    return this.prisma.inventoryDamage.create({
      data: {
        inventoryId: dto.inventoryId,
        reportedBy: userId,
        description: dto.description,
        qtyDamaged: dto.qtyDamaged,
        photoUrl: dto.photoUrl,
        status: 'unresolved',
      },
      include: {
        inventory: { select: { name: true, projectId: true } },
      },
    });
  }

  /** Get all damage reports for a project */
  async getDamageReports(projectId: string) {
    return this.prisma.inventoryDamage.findMany({
      where: {
        inventory: { projectId },
      },
      orderBy: { reportedAt: 'desc' },
      include: {
        inventory: { select: { id: true, name: true, category: true } },
      },
    });
  }

  /** Update damage status */
  async updateDamageStatus(damageId: string, dto: UpdateDamageStatusDto) {
    const damage = await this.prisma.inventoryDamage.findUnique({ where: { id: damageId } });
    if (!damage) throw new NotFoundException('Damage report not found');

    return this.prisma.inventoryDamage.update({
      where: { id: damageId },
      data: {
        status: dto.status,
        resolvedAt: dto.status === 'resolved' ? new Date() : null,
      },
    });
  }

  // ─────────────────────────────────────────────
  // LOW STOCK ALERTS
  // ─────────────────────────────────────────────

  /** Get all low stock items for a project */
  async getLowStockAlerts(projectId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { projectId },
      orderBy: { currentQty: 'asc' },
    });

    const lowStock = items.filter((item) => item.currentQty <= item.minStockQty);

    return lowStock.map((item) => ({
      ...item,
      stockStatus: this.getStockStatus(item.currentQty, item.minStockQty),
      shortage: item.minStockQty - item.currentQty,
    }));
  }

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────

  private async findItemOrFail(id: string, projectId: string) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, projectId } });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  private getStockStatus(currentQty: number, minStockQty: number): string {
    if (currentQty === 0) return 'Out of Stock';
    if (currentQty <= minStockQty * 0.5) return 'Critical';
    if (currentQty <= minStockQty) return 'Low Stock';
    return 'In Stock';
  }
}