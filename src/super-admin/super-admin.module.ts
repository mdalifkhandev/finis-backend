import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SuperAdminDashboardController } from './dashboard/dashboard.controller';
import { SuperAdminDashboardService } from './dashboard/dashboard.service';
import { SuperAdminCompaniesController } from './company/companies.controller';
import { SuperAdminCompaniesService } from './company/companies.service';
import { SuperAdminProjectController } from './projects/project.controller';
import { SuperAdminProjectService } from './projects/project.service';
import { TeamManagementController } from './team-management/team-management.controller';
import { TeamManagementService } from './team-management/team-management.service';
import { PayrollManagementController } from './payroll-management/payroll-management.controller';
import { PayrollManagementService } from './payroll-management/payroll-management.service';
import { StripeService } from '../admin/payroll/stripe.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    SuperAdminDashboardController,
    SuperAdminCompaniesController,
    SuperAdminProjectController,
    TeamManagementController,
    PayrollManagementController,
  ],
  providers: [
    SuperAdminDashboardService,
    SuperAdminCompaniesService,
    SuperAdminProjectService,
    TeamManagementService,
    PayrollManagementService,
    StripeService,
  ],
  exports: [],
})
export class SuperAdminModule {}