import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReimbursementExpensesController } from './reimbursement-expenses.controller';
import { ReimbursementExpensesService } from './reimbursement-expenses.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReimbursementExpensesController],
  providers: [ReimbursementExpensesService],
})
export class ReimbursementExpensesModule {}
