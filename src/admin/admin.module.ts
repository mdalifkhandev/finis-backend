import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';

import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';

import { CompanyController } from './company/company.controller';
import { CompanyService } from './company/company.service';

import { ProjectController } from './project/project.controller';
import { ProjectService } from './project/project.service';

import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';

import { GeofencingGateway } from './project/geofencing.gateway';
import { TeamController } from './project/team.controller';

import { TaskController } from './task/task.controller';
import { TaskService } from './task/task.service';

import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { PayrollController } from './payroll/payroll.controller';
import { PayrollService } from './payroll/payroll.service';
import { StripeService } from './payroll/stripe.service';
import { PublicPayrollController } from './payroll/public.payroll.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    DashboardController,
    CompanyController,
    ProjectController,
    TeamController,
    ProfileController,
    TaskController,
    InventoryController,
    PayrollController,
    PublicPayrollController,
  ],
  providers: [
    DashboardService,
    CompanyService,
    ProjectService,
    ProfileService,
    GeofencingGateway,
    TaskService,
    InventoryService,
    PayrollService,
    StripeService,
  ],
  exports: [CompanyService, ProjectService, InventoryService, PayrollService, StripeService],
})
export class AdminModule {}