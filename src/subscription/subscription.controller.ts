import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/client';
import { VerifyCheckoutDto } from './subscription.dto';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post('verify-and-checkout')
  verifyAndCheckout(@Body() dto: VerifyCheckoutDto) {
    return this.subscriptionService.verifyAndCheckout(dto);
  }

  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.subscriptionService.handleWebhook(req.rawBody, signature);
  }
}

@Controller('admin/subscription')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
export class AdminSubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('status')
  getStatus(@CurrentUser('id') userId: string) {
    return this.subscriptionService.getAdminSubscriptionStatus(userId);
  }

  @Get('history')
  getHistory(@CurrentUser('id') userId: string) {
    return this.subscriptionService.getAdminSubscriptionHistory(userId);
  }
}
