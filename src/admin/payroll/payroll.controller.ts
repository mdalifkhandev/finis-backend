import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import {
  PayrollSummaryQueryDto,
  ApprovePayrollDto,
  ProcessPayrollDto,
  CreatePayrollDto,
} from './dto/payroll.dto';

@Controller('admin/payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private payrollService: PayrollService) {}

  // ─── Payroll CRUD ─────────────────────────────────────────────────────────

  /** POST /admin/payroll */
  @Post()
  @Roles(UserRole.admin, UserRole.super_admin)
  createPayroll(
    @Body() dto: CreatePayrollDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.payrollService.createPayroll(dto, adminId, userRole);
  }

  /** GET /admin/payroll/summary?month=1&year=2025&projectId=uuid */
  @Get('summary')
  @Roles(UserRole.admin, UserRole.super_admin)
  getPayrollSummary(
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: PayrollSummaryQueryDto,
    @Query('projectId') projectId?: string,
  ) {
    return this.payrollService.getPayrollSummary(
      adminId,
      userRole,
      query.month,
      query.year,
      projectId,
    );
  }

  /** GET /admin/payroll/:id/stub */
  @Get(':id/stub')
  @Roles(UserRole.admin, UserRole.super_admin, UserRole.worker)
  getPayStub(
    @Param('id') payrollId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.payrollService.getPayStub(payrollId, userId, userRole);
  }

  /** PATCH /admin/payroll/:id/approve */
  @Patch(':id/approve')
  @Roles(UserRole.admin, UserRole.super_admin)
  approvePayroll(
    @Param('id') payrollId: string,
    @Body() dto: ApprovePayrollDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.payrollService.approvePayroll(
      payrollId,
      adminId,
      userRole,
      dto,
    );
  }

  /** POST /admin/payroll/process?month=1&year=2025&projectId=uuid */
  @Post('process')
  @Roles(UserRole.admin, UserRole.super_admin)
  processPayroll(
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: ProcessPayrollDto,
    @Query('projectId') projectId?: string,
  ) {
    return this.payrollService.processPayroll(
      adminId,
      userRole,
      query.month,
      query.year,
      projectId,
    );
  }

  
}