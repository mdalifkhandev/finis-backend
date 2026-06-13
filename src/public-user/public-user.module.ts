import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicUserController } from './public-user.controller';
import { PublicUserService } from './public-user.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicUserController],
  providers: [PublicUserService],
  exports: [PublicUserService],
})
export class PublicUserModule {}
