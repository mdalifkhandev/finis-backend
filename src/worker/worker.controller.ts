import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { WorkerService } from './worker.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  SubmitTaskReportDto,
  CheckInDto,
  CheckOutDto,
  CreateLeaveRequestDto,
  UpdateProfileDto,
  ChangePasswordDto,
  CreateSupportRequestDto,
  UpdateLocationDto,
} from './dto/worker.dto';

@Controller('worker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('worker', 'manager', 'admin', 'super_admin')
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  // ─────────────────────────────────────────────
  // DASHBOARD
  // ─────────────────────────────────────────────

  /**
   * GET /worker/dashboard
   * Home screen - today's tasks, clock status, this week schedule
   */
  @Get('dashboard')
  getDashboard(@CurrentUser('id') workerId: string) {
    return this.workerService.getDashboard(workerId);
  }

  // ─────────────────────────────────────────────
  // TASKS
  // ─────────────────────────────────────────────

  /**
   * GET /worker/tasks?status=pending&search=wiring&page=1&limit=10
   */
  @Get('tasks')
  getMyTasks(
    @CurrentUser('id') workerId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.workerService.getMyTasks(workerId, status, search, +page, +limit);
  }

  /**
   * GET /worker/tasks/:id
   * Task details (geofence, floor, room, inventory, previous reports)
   */
  @Get('tasks/:id')
  getTaskDetail(
    @Param('id', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') workerId: string,
  ) {
    return this.workerService.getTaskDetail(taskId, workerId);
  }

  /**
   * POST /worker/tasks/:id/start
   * Task start now → status: pending → in_progress
   */
  @Post('tasks/:id/start')
  startTask(
    @Param('id', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') workerId: string,
  ) {
    return this.workerService.startTask(taskId, workerId);
  }

  /**
   * POST /worker/tasks/:id/report
   * Task report submit (before/after photo, inventory used, notes, receipt)
   * → status: in_progress → review
   */
  @Post('tasks/:id/report')
  submitTaskReport(
    @Param('id', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') workerId: string,
    @Body() dto: SubmitTaskReportDto,
  ) {
    return this.workerService.submitTaskReport(taskId, workerId, dto);
  }

  /**
   * GET /worker/tasks/:id/inventory
   * Task  available inventory items (project  company )
   */
  @Get('tasks/:id/inventory')
  getTaskInventoryItems(
    @Param('id', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') workerId: string,
  ) {
    return this.workerService.getTaskInventoryItems(taskId, workerId);
  }

  // ─────────────────────────────────────────────
  // ATTENDANCE
  // ─────────────────────────────────────────────

  /**
   * GET /worker/attendance/today
   * today's attendance status (clocked_in / clocked_out / not_recorded)
   */
  @Get('attendance/today')
  getTodayAttendance(@CurrentUser('id') workerId: string) {
    return this.workerService.getTodayAttendance(workerId);
  }

  /**
   * POST /worker/attendance/check-in
   * Check in (optional: lat/lng for location)
   */
  @Post('attendance/check-in')
  checkIn(
    @CurrentUser('id') workerId: string,
    @Body() dto: CheckInDto,
  ) {
    return this.workerService.checkIn(workerId, dto);
  }

  /**
   * POST /worker/attendance/check-out
   * Check out → hours worked auto calculate
   */
  @Post('attendance/check-out')
  checkOut(
    @CurrentUser('id') workerId: string,
    @Body() dto: CheckOutDto,
  ) {
    return this.workerService.checkOut(workerId, dto);
  }

  /**
   * GET /worker/attendance/history?page=1&limit=20
   * Attendance history
   */
  @Get('attendance/history')
  getAttendanceHistory(
    @CurrentUser('id') workerId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.workerService.getAttendanceHistory(workerId, +page, +limit);
  }

  // ─────────────────────────────────────────────
  // LEAVE REQUESTS
  // ─────────────────────────────────────────────

  /**
   * GET /worker/leave-requests
   * my all leave requests
   */
  @Get('leave-requests')
  getMyLeaveRequests(@CurrentUser('id') workerId: string) {
    return this.workerService.getMyLeaveRequests(workerId);
  }

  /**
   * POST /worker/leave-requests
   * Leave request 
   */
  @Post('leave-requests')
  createLeaveRequest(
    @CurrentUser('id') workerId: string,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.workerService.createLeaveRequest(workerId, dto);
  }

  /**
   * DELETE /worker/leave-requests/:id
   * Leave request cancel  (only pending)
   */
  @Delete('leave-requests/:id')
  cancelLeaveRequest(
    @Param('id', ParseUUIDPipe) leaveId: string,
    @CurrentUser('id') workerId: string,
  ) {
    return this.workerService.cancelLeaveRequest(leaveId, workerId);
  }

  // ─────────────────────────────────────────────
  // PROFILE
  // ─────────────────────────────────────────────

  /**
   * GET /worker/profile
   * my full profile (company, certifications, emergency contacts)
   */
  @Get('profile')
  getProfile(@CurrentUser('id') workerId: string) {
    return this.workerService.getProfile(workerId);
  }

  /**
   * PUT /worker/profile
   * Profile update (name, phone, DOB, address, avatar)
   */
  @Put('profile')
  updateProfile(
    @CurrentUser('id') workerId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.workerService.updateProfile(workerId, dto);
  }

  /**
   * POST /worker/profile/change-password
   * Password change (current password verify )
   */
  @Post('profile/change-password')
  changePassword(
    @CurrentUser('id') workerId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.workerService.changePassword(workerId, dto);
  }

  // ─────────────────────────────────────────────
  // SUPPORT REQUEST
  // ─────────────────────────────────────────────

  /**
   * POST /worker/support
   * Admin or Manager  support request send
   */
  @Post('support')
  createSupportRequest(
    @CurrentUser('id') workerId: string,
    @Body() dto: CreateSupportRequestDto,
  ) {
    return this.workerService.createSupportRequest(workerId, dto);
  }

  // ─────────────────────────────────────────────
  // LOCATION
  // ─────────────────────────────────────────────

  /**
   * POST /worker/location
   * Location update + geofence violation check
   */
  @Post('location')
  updateLocation(
    @CurrentUser('id') workerId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.workerService.updateLocation(workerId, dto);
  }

  // ─────────────────────────────────────────────
  // NOTIFICATIONS
  // ─────────────────────────────────────────────

  /**
   * GET /worker/notifications?page=1&limit=20
   * আমার সব notifications (unread count সহ)
   */
  @Get('notifications')
  getMyNotifications(
    @CurrentUser('id') workerId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.workerService.getMyNotifications(workerId, +page, +limit);
  }

  /**
   * POST /worker/notifications/read-all
   *  notifications read mark do
   */
  @Post('notifications/read-all')
  markNotificationsRead(@CurrentUser('id') workerId: string) {
    return this.workerService.markNotificationsRead(workerId);
  }
}