import { Module } from '@nestjs/common';
import { MailboxController } from './mailbox.controller';
import { MailboxService } from './mailbox.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MailboxController],
  providers: [MailboxService],
  exports: [MailboxService],
})
export class MailboxModule {}
