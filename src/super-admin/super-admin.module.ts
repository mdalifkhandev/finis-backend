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

@Module({
  imports: [PrismaModule],
  controllers: [
    SuperAdminDashboardController,
    SuperAdminCompaniesController,
    SuperAdminProjectController,
    TeamManagementController,
  ],
  providers: [
    SuperAdminDashboardService,
    SuperAdminCompaniesService,
    SuperAdminProjectService,
    TeamManagementService,
  ],
  exports: [],
})
export class SuperAdminModule {}