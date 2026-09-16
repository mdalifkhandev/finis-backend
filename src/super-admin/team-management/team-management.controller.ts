import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import { TeamManagementService } from './team-management.service';

@Controller('super_admin/team')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.super_admin, UserRole.admin)
export class TeamManagementController {
  constructor(private teamService: TeamManagementService) { }

  /** GET /super_admin/team/admins/stats */
  @Get('admins/stats')
  getAdminStats(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.teamService.getAdminStats(userId, userRole);
  }

  /** GET /super_admin/team/admins?search=&status= */
  @Get('admins')
  getAdminList(
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.teamService.getAdminList(search, status);
  }

  /** GET /super_admin/team/users/:id */
  @Get('users/:id')
  getUserDetailsById(@Param('id') id: string) {
    return this.teamService.getUserDetailsById(id);
  }

  /** GET /super_admin/team/managers/stats */
  @Get('managers/stats')
  getManagerStats(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.teamService.getManagerStats(userId, userRole);
  }

  /** GET /super_admin/team/workforce/stats */
  @Get('workforce/stats')
  getWorkforceStats(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.teamService.getWorkforceStats(userId, userRole);
  }

  /** GET /super_admin/team/invitations/pending?role=admin&search= */
  @Get('invitations/pending')
  @Roles(UserRole.super_admin, UserRole.admin)
  getPendingInvitations(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    return this.teamService.getPendingInvitations(userId, userRole, search, role);
  }

  /** PATCH /super_admin/team/users/:id/status */
  @Patch('users/:id/status')
  updateUserStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.teamService.updateUserStatus(id, status);
  }

  /** GET /super_admin/team/managers?search=&status= */
  @Get('managers')
  getManagerList(
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.teamService.getManagerList(search, status);
  }
}
