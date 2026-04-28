import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { MessageModule } from './message/message.module';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AdminModule,
    MessageModule,
    WorkerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
