import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import { GenerateReportDto, ExportReportDto } from './dto/reports.dto';

@Controller('super_admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.super_admin, UserRole.admin)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /** POST /super_admin/reports/generate
   *  type: payroll | project_invoices | worker_performance | expense
   */
  @Post('generate')
  generateReport(
    @Body() dto: GenerateReportDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.reportsService.generateReport(dto, userId, userRole);
  }

  /** GET /super_admin/reports/export
   *  type: payroll | project_invoices | worker_performance | expense
   */
  @Get('export')
  exportAllData(
    @Query() dto: ExportReportDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.reportsService.exportAllData(dto, userId, userRole);
  }
}