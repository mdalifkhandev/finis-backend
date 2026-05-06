import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SuperAdminDashboardController } from './dashboard/dashboard.controller';
import { SuperAdminDashboardService } from './dashboard/dashboard.service';
import { SuperAdminCompaniesController } from './company/companies.controller';
import { SuperAdminCompaniesService } from './company/companies.service';
import { SuperAdminProjectController } from './projects/project.controller';
import { SuperAdminProjectService } from './projects/project.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    SuperAdminDashboardController,
    SuperAdminCompaniesController,
    SuperAdminProjectController
  ],
  providers: [
    SuperAdminDashboardService,
    SuperAdminCompaniesService,
    SuperAdminProjectService,
  ],
  exports: [],
})
export class SuperAdminModule {}