import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectService } from './project.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import {
  CreateProjectDto,
  UpdateProjectDto,
  AddFloorDto,
  AddRoomDto,
  AddProjectMemberDto,
  CreateGeofenceDto,
} from './dto/project.dto';

@Controller('admin/projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin)
export class ProjectController {
  constructor(private projectService: ProjectService) {}

  // ─── PROJECTS ─────────────────────────────────────────────────────────────

  /** GET /admin/projects?status=active */
  @Get()
  getMyProjects(
    @CurrentUser('id') adminId: string,
    @Query('status') status?: string,
  ) {
    return this.projectService.getMyProjects(adminId, status);
  }

  /** POST /admin/projects */
  @Post()
  createProject(@Body() dto: CreateProjectDto, @CurrentUser('id') adminId: string) {
    return this.projectService.createProject(dto, adminId);
  }

  /** GET /admin/projects/:id */
  @Get(':id')
  getProjectDetails(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.projectService.getProjectDetails(id, adminId);
  }

  /** GET /admin/projects/:id/analysis */
  @Get(':id/analysis')
  getProjectAnalysis(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.projectService.getProjectAnalysis(id, adminId);
  }

  /** PUT /admin/projects/:id */
  @Put(':id')
  updateProject(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.updateProject(id, dto, adminId);
  }

  /** DELETE /admin/projects/:id */
  @Delete(':id')
  deleteProject(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.projectService.deleteProject(id, adminId);
  }

  // ─── FLOORS ───────────────────────────────────────────────────────────────

  /** POST /admin/projects/:id/floors */
  @Post(':id/floors')
  addFloor(
    @Param('id') id: string,
    @Body() dto: AddFloorDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.addFloor(id, dto, adminId);
  }

  /** DELETE /admin/projects/:id/floors/:floorId */
  @Delete(':id/floors/:floorId')
  deleteFloor(
    @Param('id') id: string,
    @Param('floorId') floorId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.deleteFloor(id, floorId, adminId);
  }

  // ─── ROOMS ────────────────────────────────────────────────────────────────

  /** POST /admin/projects/:id/floors/:floorId/rooms */
  @Post(':id/floors/:floorId/rooms')
  addRoom(
    @Param('id') id: string,
    @Param('floorId') floorId: string,
    @Body() dto: AddRoomDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.addRoom(id, floorId, dto, adminId);
  }

  /** DELETE /admin/projects/:id/rooms/:roomId */
  @Delete(':id/rooms/:roomId')
  deleteRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.deleteRoom(id, roomId, adminId);
  }

  // ─── TEAM MEMBERS ─────────────────────────────────────────────────────────

  /** GET /admin/projects/:id/team */
  @Get(':id/team')
  getTeamMembers(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.projectService.getTeamMembers(id, adminId);
  }

  /** POST /admin/projects/:id/team */
  @Post(':id/team')
  addTeamMember(
    @Param('id') id: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.addTeamMember(id, dto, adminId);
  }

  /** DELETE /admin/projects/:id/team/:userId */
  @Delete(':id/team/:userId')
  removeTeamMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.removeTeamMember(id, userId, adminId);
  }

  // ─── GEOFENCING ───────────────────────────────────────────────────────────

  /** GET /admin/projects/:id/geofences */
  @Get(':id/geofences')
  getGeofences(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.projectService.getGeofences(id, adminId);
  }


  /** POST /admin/projects/:id/geofences */
  @Post(':id/geofences')
  createGeofence(
    @Param('id') id: string,
    @Body() dto: CreateGeofenceDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.createGeofence(id, dto, adminId);
  }

  /** PUT /admin/projects/:id/geofences/:geoId */
  @Put(':id/geofences/:geoId')
  updateGeofence(
    @Param('id') id: string,
    @Param('geoId') geoId: string,
    @Body() dto: Partial<CreateGeofenceDto> & { isActive?: boolean },
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.updateGeofence(id, geoId, dto, adminId);
  }

  /** DELETE /admin/projects/:id/geofences/:geoId */
  @Delete(':id/geofences/:geoId')
  deleteGeofence(
    @Param('id') id: string,
    @Param('geoId') geoId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.projectService.deleteGeofence(id, geoId, adminId);
  }
}