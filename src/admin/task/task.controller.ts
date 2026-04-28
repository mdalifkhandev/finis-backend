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
import { TaskService } from './task.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import {
  CreateTaskDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
  AssignTaskDto,
  ReviewTaskDto,
} from './dto/task.dto';

@Controller('admin/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin, UserRole.manager)
export class TaskController {
  constructor(private taskService: TaskService) {}

  /** GET /admin/tasks — Manager শুধু assigned project-এর tasks পাবে */
  @Get()
  getTasks(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('projectId') projectId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.taskService.getTasks(userId, userRole, status, search, projectId, +page, +limit);
  }

  /** GET /admin/tasks/:id */
  @Get(':id')
  getTaskDetails(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.getTaskDetails(id, userId, userRole);
  }

  /** POST /admin/tasks — Manager পারবে */
  @Post()
  createTask(
    @Body() dto: CreateTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.createTask(dto, userId, userRole);
  }

  /** POST /admin/tasks/:id/assign — Worker assign করা (Manager পারবে) */
  @Post(':id/assign')
  assignWorker(
    @Param('id') id: string,
    @Body() dto: AssignTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.assignWorker(id, dto, userId, userRole);
  }

  /** GET /admin/tasks/:id/available-workers */
  @Get(':id/available-workers')
  getAvailableWorkers(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('search') search?: string,
  ) {
    return this.taskService.getAvailableWorkers(id, userId, userRole, search);
  }

  /** PUT /admin/tasks/:id/status — Manager পারবে */
  @Put(':id/status')
  updateTaskStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.updateTaskStatus(id, dto, userId, userRole);
  }

  /** PUT /admin/tasks/:id — Manager পারবে */
  @Put(':id')
  updateTask(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.updateTask(id, dto, userId, userRole);
  }

  /** PUT /admin/tasks/:id/reports/:reportId/review — Manager approve/reject করবে */
  @Put(':id/reports/:reportId/review')
  reviewTaskReport(
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() dto: ReviewTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.reviewTaskReport(id, reportId, dto, userId, userRole);
  }

  /** DELETE /admin/tasks/:id — Manager */
  @Delete(':id')
  @Roles(UserRole.admin, UserRole.super_admin)
  deleteTask(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.deleteTask(id, userId, userRole);
  }
}