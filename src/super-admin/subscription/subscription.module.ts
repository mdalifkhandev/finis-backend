import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import {
  SubscriptionController,
  AdminSubscriptionController,
} from './subscription.controller';

@Module({
  controllers: [SubscriptionController, AdminSubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService], // ← company/project service এ inject করা যাবে
})
export class SubscriptionModule {}
