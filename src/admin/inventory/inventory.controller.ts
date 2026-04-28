import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  UpdateStockDto,
  CreateInventoryDamageDto,
  UpdateDamageStatusDto,
  InventoryQueryDto,
} from './dto/inventory.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ─────────────────────────────────────────────
  // INVENTORY ITEMS
  // ─────────────────────────────────────────────

  /**
   * GET /inventory/:projectId
   * Get all inventory items for a company (with stats & filters)
   */
  @Get(':projectId')
  @Roles('super_admin', 'admin', 'manager', 'worker', 'viewer')
  getInventoryItems(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventoryService.getInventoryItems(projectId, query);
  }

  /**
   * GET /inventory/:projectId/low-stock
   * Get low stock alerts for dashboard
   */
  @Get(':projectId/low-stock')
  @Roles('super_admin', 'admin', 'manager')
  getLowStockAlerts(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.inventoryService.getLowStockAlerts(projectId);
  }

  /**
   * GET /inventory/:projectId/damages
   * Get all damage reports for a company
   */
  @Get(':projectId/damages')
  @Roles('super_admin', 'admin', 'manager')
  getDamageReports(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.inventoryService.getDamageReports(projectId);
  }

  /**
   * GET /inventory/:projectId/item/:id
   * Get single inventory item detail
   */
  @Get(':projectId/item/:id')
  @Roles('super_admin', 'admin', 'manager', 'worker', 'viewer')
  getInventoryItemById(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.getInventoryItemById(id, projectId);
  }

  /**
   * GET /inventory/:projectId/item/:id/history
   * Get stock usage history for an item
   */
  @Get(':projectId/item/:id/history')
  @Roles('super_admin', 'admin', 'manager')
  getUsageHistory(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.getUsageHistory(id, projectId);
  }

  /**
   * POST /inventory
   * Create a new inventory item
   */
  @Post()
  @Roles('super_admin', 'admin', 'manager')
  createInventoryItem(@Body() dto: CreateInventoryItemDto) {
    return this.inventoryService.createInventoryItem(dto);
  }

  /**
   * PATCH /inventory/:projectId/item/:id
   * Update inventory item details
   */
  @Patch(':projectId/item/:id')
  @Roles('super_admin', 'admin', 'manager')
  updateInventoryItem(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.inventoryService.updateInventoryItem(id, projectId, dto);
  }

  /**
   * PATCH /inventory/:projectId/item/:id/stock
   * Update stock quantity (restock or usage)
   */
  @Patch(':projectId/item/:id/stock')
  @Roles('super_admin', 'admin', 'manager', 'worker')
  updateStock(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
    @Request() req: any,
  ) {
    return this.inventoryService.updateStock(id, projectId, req.user.id, dto);
  }

  /**
   * DELETE /inventory/:projectId/item/:id
   * Delete an inventory item
   */
  @Delete(':projectId/item/:id')
  @Roles('super_admin', 'admin')
  deleteInventoryItem(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.deleteInventoryItem(id, projectId);
  }

  // ─────────────────────────────────────────────
  // DAMAGE REPORTS
  // ─────────────────────────────────────────────

  /**
   * POST /inventory/damages
   * Report a damage
   */
  @Post('damages')
  @Roles('super_admin', 'admin', 'manager', 'worker')
  reportDamage(@Body() dto: CreateInventoryDamageDto, @Request() req: any) {
    return this.inventoryService.reportDamage(req.user.id, dto);
  }

  /**
   * PATCH /inventory/damages/:damageId/status
   * Update damage status (resolve, write-off, etc.)
   */
  @Patch('damages/:damageId/status')
  @Roles('super_admin', 'admin', 'manager')
  updateDamageStatus(
    @Param('damageId', ParseUUIDPipe) damageId: string,
    @Body() dto: UpdateDamageStatusDto,
  ) {
    return this.inventoryService.updateDamageStatus(damageId, dto);
  }
}