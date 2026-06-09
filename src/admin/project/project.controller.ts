import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
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
  UpdateFloorDto,
  AddRoomDto,
  UpdateRoomDto,
  AddProjectMemberDto,
  CreateGeofenceDto,
} from './dto/project.dto';

@Controller('admin/projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin, UserRole.manager)
export class ProjectController {
  constructor(private projectService: ProjectService) { }
  // ─── PROJECTS ──────────────────────────────────────────────────────────────

  /** GET /admin/projects */
  @Get()
  getMyProjects(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.projectService.getMyProjects(userId, userRole, status, search);
  }


  /** GET /admin/projects/names */
  @Get('names')
  getMyProjectNames(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getMyProjectNames(userId, userRole);
  }

  /** POST /admin/projects */
  @Post()
  @Roles(UserRole.admin, UserRole.super_admin)
  createProject(
    @Body() dto: CreateProjectDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.createProject(dto, adminId, userRole);
  }

  // ─── PROJECT PROFILE (screen 1: budget, description, client info) ──────────

  /** GET /admin/projects/:id/profile
   *  Returns: name, status, budget, spent, remaining, description,
   *           location, startDate, endDate, company (client info), progress
   */
  @Get(':id/profile')
  getProjectProfile(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getProjectProfile(id, userId, userRole);
  }

  /** GET /admin/projects/:id/documents
   *  Returns: all documents uploaded for the project
   */
  @Get(':id/documents')
  getProjectDocuments(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getProjectDocuments(id, userId, userRole);
  }

  /** PUT /admin/projects/:id — Edit Project screen */
  @Put(':id')
  @Roles(UserRole.admin, UserRole.super_admin, UserRole.manager)
  updateProject(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.updateProject(id, dto, adminId, userRole);
  }

  /** DELETE /admin/projects/:id */
  @Delete(':id')
  @Roles(UserRole.admin, UserRole.super_admin, UserRole.manager)
  deleteProject(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.deleteProject(id, adminId, userRole);
  }

  // ─── FLOOR PLAN (screen: Floor & Room Setup) ───────────────────────────────

  /** GET /admin/projects/:id/floor-plan
   *  Returns: all floors with their rooms, task counts per room
   */
  @Get(':id/floor-plan')
  getFloorPlan(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getFloorPlan(id, userId, userRole);
  }

  /** GET /admin/projects/:id/floors
   *  Returns: floor names only
   */
  @Get(':id/floors')
  getFloorNames(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getFloorNames(id, userId, userRole);
  }

  /** POST /admin/projects/:id/floors */
  @Post(':id/floors')
  addFloor(
    @Param('id') id: string,
    @Body() dto: AddFloorDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.addFloor(id, dto, userId, userRole);
  }

  /** PUT /admin/projects/:id/floors/:floorId */
  @Put(':id/floors/:floorId')
  updateFloor(
    @Param('id') id: string,
    @Param('floorId') floorId: string,
    @Body() dto: UpdateFloorDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.updateFloor(id, floorId, dto, userId, userRole);
  }

  /** DELETE /admin/projects/:id/floors/:floorId */
  @Delete(':id/floors/:floorId')
  deleteFloor(
    @Param('id') id: string,
    @Param('floorId') floorId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.deleteFloor(id, floorId, userId, userRole);
  }

  // ─── ROOMS ─────────────────────────────────────────────────────────────────

  /** POST /admin/projects/:id/floors/:floorId/rooms */
  @Post(':id/floors/:floorId/rooms')
  addRoom(
    @Param('id') id: string,
    @Param('floorId') floorId: string,
    @Body() dto: AddRoomDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.addRoom(id, floorId, dto, userId, userRole);
  }

  /** GET /admin/projects/:id/floors/:floorId/rooms
   *  Returns: room names only
   */
  @Get(':id/floors/:floorId/rooms')
  getRoomNames(
    @Param('id') id: string,
    @Param('floorId') floorId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getRoomNames(id, floorId, userId, userRole);
  }

  /** PUT /admin/projects/:id/rooms/:roomId */
  @Put(':id/rooms/:roomId')
  updateRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.updateRoom(id, roomId, dto, userId, userRole);
  }

  /** DELETE /admin/projects/:id/rooms/:roomId */
  @Delete(':id/rooms/:roomId')
  deleteRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.deleteRoom(id, roomId, userId, userRole);
  }

  // ─── PROJECT ANALYSIS (screen: checklist floors/tasks) ────────────────────

  /** GET /admin/projects/:id/analysis
   *  Returns: budget summary, task stats, floor-wise task breakdown (checklist)
   */
  @Get(':id/analysis')
  getProjectAnalysis(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getProjectAnalysis(id, userId, userRole);
  }

  // ─── TEAM ──────────────────────────────────────────────────────────────────

  /** GET /admin/projects/:id/team/managers */
  @Get(':id/team/managers')
  getManagers(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getManagers(id, userId, userRole);
  }

  /** GET /admin/projects/:id/team/workers */
  @Get(':id/team/workers')
  getWorkers(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getWorkers(id, userId, userRole);
  }

  /** GET /admin/projects/:id/team/managers/:managerId/workers-count */
  @Get(':id/team/managers/:managerId/workers-count')
  getManagerWorkersCount(
    @Param('id') id: string,
    @Param('managerId') managerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getManagerWorkersCount(id, managerId, userId, userRole);
  }

  /** GET /admin/projects/:id/team/managers/:managerId/workers
   *  Returns: list of workers assigned to the given manager within the project
   */
  @Get(':id/team/managers/:managerId/workers')
  getManagerWorkers(
    @Param('id') id: string,
    @Param('managerId') managerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getWorkersByManager(id, managerId, userId, userRole);
  }

  /** POST /admin/projects/:id/team/managers */
  @Post(':id/team/managers')
  @Roles(UserRole.admin, UserRole.super_admin)
  addManager(
    @Param('id') id: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.addMemberByRole(id, dto.userId, adminId, 'manager', undefined, userRole);
  }

  /** POST /admin/projects/:id/team/workers */
  @Post(':id/team/workers')
  @Roles(UserRole.admin, UserRole.super_admin, UserRole.manager)
  addWorker(
    @Param('id') id: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string, // ← যোগ করো
  ) {
    return this.projectService.addMemberByRole(id, dto.userId, adminId, 'worker', dto.managerId, userRole);
  }

  /** DELETE /admin/projects/:id/team/:userId */
  @Delete(':id/team/:userId')
  @Roles(UserRole.admin, UserRole.super_admin, UserRole.manager)
  removeTeamMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.removeTeamMember(id, userId, adminId, userRole);
  }

  // ─── GEOFENCES ─────────────────────────────────────────────────────────────

  /** GET /admin/projects/:id/geofences */
  @Get(':id/geofences')
  getGeofences(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.getGeofences(id, userId, userRole);
  }

  /** POST /admin/projects/:id/geofences */
  @Post(':id/geofences')
  createGeofence(
    @Param('id') id: string,
    @Body() dto: CreateGeofenceDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.createGeofence(id, dto, userId, userRole);
  }

  /** PUT /admin/projects/:id/geofences/:geoId */
  @Put(':id/geofences/:geoId')
  updateGeofence(
    @Param('id') id: string,
    @Param('geoId') geoId: string,
    @Body() dto: Partial<CreateGeofenceDto> & { isActive?: boolean },
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.updateGeofence(id, geoId, dto, userId, userRole);
  }

  @Patch(':id/geofences/violations/:violationId/resolve')
  resolveViolation(
    @Param('violationId') violationId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.resolveViolation(violationId, userId, userRole);
  }

  /** DELETE /admin/projects/:id/geofences/:geoId */
  @Delete(':id/geofences/:geoId')
  deleteGeofence(
    @Param('id') id: string,
    @Param('geoId') geoId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.projectService.deleteGeofence(id, geoId, userId, userRole);
  }


  /** GET /admin/projects/:id/geofences/location-logs */
  @Get(':id/geofences/location-logs')
  getLocationLogs(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.projectService.getLocationLogs(
      id,
      userId,
      userRole,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  /** GET /admin/projects/:id/geofences/violations */
  @Get(':id/geofences/violations')
  getViolations(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.projectService.getViolations(
      id,
      userId,
      userRole,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  /** GET /admin/projects/:id/geofences/time-summary?date=2025-01-15 */
  @Get(':id/geofences/time-summary')
  getTimeSummary(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('date') date?: string,
  ) {
    return this.projectService.getTimeSummary(id, userId, userRole, date);
  }
}