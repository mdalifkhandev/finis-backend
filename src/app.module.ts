import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { MessageModule } from './message/message.module';
import { WorkerModule } from './worker/worker.module';
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { PublicUserModule } from './public-user/public-user.module';
import { ManagerModule } from './manager/manager.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PublicPlansModule } from './public-plans/public-plans.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { ConfigModule } from '@nestjs/config';
import { PublicContentModule } from './public-content/public-content.module';
import { MailboxModule } from './mailbox/mailbox.module';
import { PublicShareModule } from './public-share/public-share.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AdminModule,
    MessageModule,
    WorkerModule,
    SuperAdminModule,
    PublicUserModule,
    ManagerModule,
    NotificationsModule,
    PublicPlansModule,
    PublicContentModule,
    MailboxModule,
    SubscriptionModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '7d' },
    }),
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
    PublicShareModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
