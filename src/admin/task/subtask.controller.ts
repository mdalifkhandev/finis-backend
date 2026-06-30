import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TaskService } from './task.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';

@Controller('admin/subtasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.manager, UserRole.super_admin)
export class SubTaskController {
  constructor(private readonly taskService: TaskService) {}

  /** GET /admin/subtasks — সব subtask with pagination/filter */
  @Get()
  getSubTasks(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('taskId') taskId?: string,
    @Query('projectId') projectId?: string,
    @Query('unitId') unitId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.taskService.getAllSubTasks(userId, userRole, {
      taskId,
      projectId,
      unitId,
      status,
      search,
      page: +page,
      limit: +limit,
    });
  }

  /** GET /admin/subtasks/:id — single subtask details */
  @Get(':id')
  getSubTaskDetails(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.getAdminSubTaskDetails(userId, userRole, id);
  }
}
