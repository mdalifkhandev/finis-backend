import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CreateReimbursementExpenseDto, ReimbursementExpenseFilterDto, RejectReimbursementExpenseDto, UpdateReimbursementExpenseDto } from './dto/reimbursement-expense.dto';
import { ReimbursementExpensesService } from './reimbursement-expenses.service';

@Controller('admin/reimbursement-expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin)
export class ReimbursementExpensesController {
  constructor(private readonly service: ReimbursementExpensesService) {}
  @Get() findAll(@CurrentUser('id') adminId: string, @CurrentUser('role') role: string, @Query() query: ReimbursementExpenseFilterDto) { return this.service.findAll(adminId, role, query); }
  @Get('summary') getSummary(@CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.getSummary(adminId, role); }
  @Get(':id') findOne(@Param('id') id: string, @CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.findOne(id, adminId, role); }
  @Post() create(@Body() dto: CreateReimbursementExpenseDto, @CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.create(dto, adminId, role); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateReimbursementExpenseDto, @CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.update(id, dto, adminId, role); }
  @Delete(':id') remove(@Param('id') id: string, @CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.remove(id, adminId, role); }
  @Post(':id/submit') submit(@Param('id') id: string, @CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.submit(id, adminId, role); }
  @Post(':id/approve') approve(@Param('id') id: string, @CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.approve(id, adminId, role); }
  @Post(':id/reject') reject(@Param('id') id: string, @Body() dto: RejectReimbursementExpenseDto, @CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.reject(id, dto, adminId, role); }
  @Post(':id/mark-paid') markPaid(@Param('id') id: string, @CurrentUser('id') adminId: string, @CurrentUser('role') role: string) { return this.service.markPaid(id, adminId, role); }
}
