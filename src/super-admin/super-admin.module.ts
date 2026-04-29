import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SuperAdminDashboardController } from './dashboard/dashboard.controller';
import { SuperAdminDashboardService } from './dashboard/dashboard.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    SuperAdminDashboardController
  ],
  providers: [
    SuperAdminDashboardService
  ],
  exports: [],
})
export class SuperAdminModule {}