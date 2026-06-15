import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicPlansController } from './public-plans.controller';
import { PublicPlansService } from './public-plans.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicPlansController],
  providers: [PublicPlansService],
})
export class PublicPlansModule {}
