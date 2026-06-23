import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { MessageGateway } from './message.gateway';
import { NotificationsModule } from '../notifications/notifications.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [
    NotificationsModule,
    S3Module,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [MessageController],
  providers: [MessageService, MessageGateway],
  exports: [MessageService, MessageGateway],
})
export class MessageModule {}
