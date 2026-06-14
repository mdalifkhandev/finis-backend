import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QuotesModule } from './quotes/quotes.module';

@Module({
  imports: [PrismaModule, QuotesModule],
  exports: [QuotesModule],
})
export class ManagerModule {}
