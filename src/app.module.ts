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
import { SuperAdminModule } from './super-admin/super-admin.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AdminModule,
    MessageModule,
    WorkerModule,
    SuperAdminModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '7d' },
    }),
    MulterModule.register({
      dest: './uploads',
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}