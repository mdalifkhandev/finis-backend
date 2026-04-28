import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { MessageService } from './message.service';
import {
  CreateDirectThreadDto,
  CreateGroupThreadDto,
  SendMessageDto,
  ThreadQueryDto,
  MessageQueryDto,
  AddParticipantDto,
} from './dto/message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('messages')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  // ─────────────────────────────────────────────
  // THREADS — Admin / Manager / Worker
  // ─────────────────────────────────────────────

  /**
   * GET /messages/threads
   * Get all threads for the current user
   * Tabs: All / 1-to-1 (direct) / Groups / Projects
   */
  @Get('threads')
  @Roles('super_admin', 'admin', 'manager', 'worker', 'viewer')
  getMyThreads(@Request() req: any, @Query() query: ThreadQueryDto) {
    return this.messageService.getMyThreads(req.user.id, query);
  }

  /**
   * GET /messages/threads/:threadId
   * Get single thread detail (participants etc.)
   */
  @Get('threads/:threadId')
  @Roles('super_admin', 'admin', 'manager', 'worker', 'viewer')
  getThreadById(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Request() req: any,
  ) {
    return this.messageService.getThreadById(threadId, req.user.id);
  }

  /**
   * POST /messages/threads/direct
   * Start a direct (1-to-1) chat
   * Used when clicking on a user from the chat list
   */
  @Post('threads/direct')
  @Roles('super_admin', 'admin', 'manager', 'worker')
  createDirectThread(@Request() req: any, @Body() dto: CreateDirectThreadDto) {
    return this.messageService.createDirectThread(req.user.id, dto);
  }

  /**
   * POST /messages/threads/group
   * Create a group or project thread
   * Admin / Manager can create groups
   */
  @Post('threads/group')
  @Roles('super_admin', 'admin', 'manager')
  createGroupThread(@Request() req: any, @Body() dto: CreateGroupThreadDto) {
    return this.messageService.createGroupThread(req.user.id, dto);
  }

  /**
   * PATCH /messages/threads/:threadId/participants
   * Add participants to a group thread
   */
  @Patch('threads/:threadId/participants')
  @Roles('super_admin', 'admin', 'manager')
  addParticipants(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Request() req: any,
    @Body() dto: AddParticipantDto,
  ) {
    return this.messageService.addParticipants(threadId, req.user.id, dto);
  }

  /**
   * DELETE /messages/threads/:threadId/participants/:userId
   * Remove a participant from group thread
   */
  @Delete('threads/:threadId/participants/:userId')
  @Roles('super_admin', 'admin', 'manager')
  removeParticipant(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    return this.messageService.removeParticipant(threadId, req.user.id, userId);
  }

  // ─────────────────────────────────────────────
  // MESSAGES
  // ─────────────────────────────────────────────

  /**
   * GET /messages/threads/:threadId/messages
   * Get paginated messages in a thread
   * Also marks messages as read
   */
  @Get('threads/:threadId/messages')
  @Roles('super_admin', 'admin', 'manager', 'worker', 'viewer')
  getMessages(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Request() req: any,
    @Query() query: MessageQueryDto,
  ) {
    return this.messageService.getMessages(threadId, req.user.id, query);
  }

  /**
   * POST /messages/send
   * Send a message via REST (fallback if socket unavailable)
   * Supports text + media (Photo / Camera / Location)
   */
  @Post('send')
  @Roles('super_admin', 'admin', 'manager', 'worker')
  sendMessage(@Request() req: any, @Body() dto: SendMessageDto) {
    return this.messageService.sendMessage(req.user.id, dto);
  }

  /**
   * DELETE /messages/:messageId
   * Delete own message
   */
  @Delete(':messageId')
  @Roles('super_admin', 'admin', 'manager', 'worker')
  deleteMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Request() req: any,
  ) {
    return this.messageService.deleteMessage(messageId, req.user.id);
  }

  // ─────────────────────────────────────────────
  // SUPER ADMIN ONLY
  // ─────────────────────────────────────────────

  /**
   * GET /messages/admin/threads
   * Super admin: view ALL threads across the system
   * Shows All / 1-to-1 / Groups / Projects tabs
   */
  @Get('admin/threads')
  @Roles('super_admin')
  getAllThreads(@Query() query: ThreadQueryDto) {
    return this.messageService.getAllThreads(query);
  }

  /**
   * PATCH /messages/admin/threads/:threadId/close
   * Super admin: close/deactivate a thread
   */
  @Patch('admin/threads/:threadId/close')
  @Roles('super_admin')
  closeThread(@Param('threadId', ParseUUIDPipe) threadId: string) {
    return this.messageService.closeThread(threadId);
  }

  /**
   * GET /messages/admin/threads/:threadId/export
   * Super admin: export full thread conversation
   */
  @Get('admin/threads/:threadId/export')
  @Roles('super_admin')
  exportThread(@Param('threadId', ParseUUIDPipe) threadId: string) {
    return this.messageService.exportThread(threadId);
  }
}