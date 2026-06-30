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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { TaskService } from './task.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import { S3Service } from '../../s3/s3.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
  AssignTaskDto,
  ReviewTaskDto,
  CreateSubTaskDto,
} from './dto/task.dto';

@Controller('admin/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.manager, UserRole.super_admin)
export class TaskController {
  constructor(
    private taskService: TaskService,
    private s3Service: S3Service,
  ) {}

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

  /** GET /admin/tasks/:id/locations — selected floors and units only */
  @Get(':id/locations')
  getTaskLocations(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.getTaskLocations(id, userId, userRole);
  }

  /** GET /admin/tasks/:id/subtasks — sub task list */
  @Get(':id/subtasks')
  getSubTasks(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.getSubTasks(id, userId, userRole);
  }

  /** GET /admin/tasks/:id/subtasks/:subTaskId — sub task details */
  @Get(':id/subtasks/:subTaskId')
  getSubTaskDetails(
    @Param('id') id: string,
    @Param('subTaskId') subTaskId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.getSubTaskDetails(id, subTaskId, userId, userRole);
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

  /** POST /admin/tasks/:id/assign — Worker assign করা (multiple unit support) */
  @Post(':id/assign')
  assignWorker(
    @Param('id') id: string,
    @Body() dto: AssignTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.assignWorker(id, dto, userId, userRole);
  }

  /** POST /admin/tasks/:id/subtasks — sub task create */
  @Post(':id/subtasks')
  createSubTask(
    @Param('id') id: string,
    @Body() dto: CreateSubTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.createSubTask(id, dto, userId, userRole);
  }

  /** PUT /admin/tasks/:id/subtasks/:subTaskId/approval — worker sub task approval */
  @Put(':id/subtasks/:subTaskId/approval')
  reviewSubTaskCreation(
    @Param('id') id: string,
    @Param('subTaskId') subTaskId: string,
    @Body() dto: ReviewTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.reviewSubTaskCreation(id, subTaskId, dto, userId, userRole);
  }

  /** GET /admin/tasks/:id/available-workers */
  @Get(':id/available-workers')
  getAvailableWorkers(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('search') search?: string,
    @Query('unitId') unitId?: string,
  ) {
    return this.taskService.getAvailableWorkers(id, userId, userRole, search, unitId);
  }

  /** PUT /admin/tasks/:id/approval — task creation approval/rejection */
  @Put(':id/approval')
  reviewTaskApproval(
    @Param('id') id: string,
    @Body() dto: ReviewTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.reviewTaskApproval(id, dto, userId, userRole);
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
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async updateTask(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const uploadedFile = file
      ? { ...file, filename: await this.s3Service.uploadFile(file, 'task-expenses') }
      : undefined;
    return this.taskService.updateTask(id, dto, userId, userRole, uploadedFile);
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

  /** PUT /admin/tasks/:id/completion-review — final approval after all units complete */
  @Put(':id/completion-review')
  reviewTaskCompletion(
    @Param('id') id: string,
    @Body() dto: ReviewTaskDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.taskService.reviewTaskCompletion(id, dto, userId, userRole);
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
