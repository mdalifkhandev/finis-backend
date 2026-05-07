import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ExpenseManagementService } from './expense-management.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import {
  ExpenseQueryDto,
  ReviewExpenseDto,
  UpdateExpenseProjectDto,
} from './dto/expense-management.dto';

@Controller('super_admin/expense-management')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.super_admin, UserRole.admin)
export class ExpenseManagementController {
  constructor(private expenseManagementService: ExpenseManagementService) {}

  // ─── IMAGE 1: Dashboard + List ────────────────────────────────────────────

  /** GET /admin/expense-management/stats */
  @Get('stats')
  getStats(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.expenseManagementService.getStats(userId, userRole);
  }

  /** GET /admin/expense-management
   *  ?status=pending|approved|rejected
   *  &search=worker or description
   */
  @Get()
  getExpenses(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: ExpenseQueryDto,
  ) {
    return this.expenseManagementService.getExpenses(userId, userRole, query);
  }

  /** GET /admin/expense-management/export */
  @Get('export')
  exportReport(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: ExpenseQueryDto,
  ) {
    return this.expenseManagementService.exportReport(userId, userRole, query);
  }

  // ─── IMAGE 2: Expense Details ─────────────────────────────────────────────

  /** GET /admin/expense-management/:id */
  @Get(':id')
  getExpenseDetail(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.expenseManagementService.getExpenseDetail(id, userId, userRole);
  }

  /** PATCH /admin/expense-management/:id/approve */
  @Patch(':id/approve')
  approveExpense(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.expenseManagementService.reviewExpense(id, 'approved', userId, userRole);
  }

  /** PATCH /admin/expense-management/:id/reject */
  @Patch(':id/reject')
  rejectExpense(
    @Param('id') id: string,
    @Body() dto: ReviewExpenseDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.expenseManagementService.reviewExpense(id, 'rejected', userId, userRole, dto.reviewNotes);
  }

  /** PATCH /admin/expense-management/:id/project
   *  Assign project & task to expense
   */
  @Patch(':id/project')
  updateExpenseProject(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseProjectDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.expenseManagementService.updateExpenseProject(id, dto, userId, userRole);
  }
}