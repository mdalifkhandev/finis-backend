import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../prisma/prisma.module';

import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';

import { CompanyController } from './company/company.controller';
import { CompanyService } from './company/company.service';

import { ProjectController } from './project/project.controller';
import { ProjectService } from './project/project.service';

import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';

import { GeofencingGateway } from './geofencing/geofencing.gateway';

@Module({
  imports: [
    PrismaModule,
    MulterModule.register({
      dest: './uploads',
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [
    DashboardController,
    CompanyController,
    ProjectController,
    ProfileController,
  ],
  providers: [
    DashboardService,
    CompanyService,
    ProjectService,
    ProfileService,
    GeofencingGateway,
  ],
  exports: [CompanyService, ProjectService],
})
export class AdminModule {}