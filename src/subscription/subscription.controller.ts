import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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
  async webhook(@Req() req: Request, @Headers('stripe-signature') signature?: string) {
    const rawBody = req.body as Buffer;
    return this.subscriptionService.handleWebhook(rawBody, signature);
  }
}

@Controller('admin/subscription')
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
