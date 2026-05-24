import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SuperAdminDashboardController } from './dashboard/dashboard.controller';
import { SuperAdminDashboardService } from './dashboard/dashboard.service';
import { SuperAdminCompaniesController } from './company/companies.controller';
import { SuperAdminCompaniesService } from './company/companies.service';
import { SuperAdminUsersController } from './users/users.controller';
import { SuperAdminUsersService } from './users/users.service';
import { SuperAdminProjectController } from './projects/project.controller';
import { SuperAdminProjectService } from './projects/project.service';
import { TeamManagementController } from './team-management/team-management.controller';
import { TeamManagementService } from './team-management/team-management.service';
import { PayrollManagementController } from './payroll-management/payroll-management.controller';
import { PayrollManagementService } from './payroll-management/payroll-management.service';
import { ExpenseManagementController } from './expense-management/expense-management.controller';
import { ExpenseManagementService } from './expense-management/expense-management.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { SubscriptionModule } from './subscription/subscription.module';

@Module({
  imports: [PrismaModule, SubscriptionModule],
  controllers: [
    SuperAdminDashboardController,
    SuperAdminCompaniesController,
    SuperAdminProjectController,
    TeamManagementController,
    PayrollManagementController,
    ExpenseManagementController,
    ReportsController,
    SuperAdminUsersController,
  ],
  providers: [
    SuperAdminDashboardService,
    SuperAdminCompaniesService,
    SuperAdminUsersService,
    SuperAdminProjectService,
    TeamManagementService,
    PayrollManagementService,
    ExpenseManagementService,
    ReportsService,
  ],
  exports: [],
})
export class SuperAdminModule {}