import { Controller, Get, Patch, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { TimeAdjustmentsService } from './time-adjustments.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('time-adjustments')
@UseGuards(JwtAuthGuard)
export class TimeAdjustmentsController {
  constructor(private readonly service: TimeAdjustmentsService) {}

  @Post('request')
  async submitRequest(
    @CurrentUser() user: any,
    @Body() body: { date: string; requestType: 'check_in' | 'check_out'; originalTime: string; adjustedTime: string; reason?: string },
  ) {
    return this.service.createRequest(user.id, body);
  }

  @Get('pending')
  async getPendingRequests(@CurrentUser() user: any) {
    return this.service.getPendingRequests(user);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { status: 'approved' | 'denied' },
  ) {
    return this.service.updateRequestStatus(id, body.status, user.id);
  }
}
