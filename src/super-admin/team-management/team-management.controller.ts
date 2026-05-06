import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import { TeamManagementService } from './team-management.service';



// team-management.controller.ts
@Controller('super_admin/team')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.super_admin, UserRole.admin)
export class TeamManagementController {
  constructor(private teamService: TeamManagementService) {}

  /** GET /admin/team/admins/stats */
  @Get('admins/stats')
  getAdminStats(@CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.teamService.getAdminStats(userId, userRole);
  }

  /** GET /admin/team/managers/stats */
  @Get('managers/stats')
  getManagerStats(@CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.teamService.getManagerStats(userId, userRole);
  }

  /** GET /admin/team/workforce/stats */
  @Get('workforce/stats')
  getWorkforceStats(@CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.teamService.getWorkforceStats(userId, userRole);
  }
}