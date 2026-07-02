import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/client';
import { MailboxService } from './mailbox.service';
import { SendMailDto } from './dto/send-mail.dto';
import { UpdateMailboxStatusDto } from './dto/update-status.dto';
import { S3Service } from '../s3/s3.service';

const pdfFileFilter = (_: unknown, file: any, cb: (error: Error | null, acceptFile: boolean) => void) => {
  const extension = extname(file.originalname).toLowerCase();
  const isPdfMimeType = file.mimetype === 'application/pdf';
  const isPdfExtension = extension === '.pdf';

  if (!isPdfMimeType || !isPdfExtension) {
    cb(new BadRequestException('Only PDF files are allowed'), false);
    return;
  }

  cb(null, true);
};

@Controller()
export class MailboxController {
  constructor(
    private readonly mailboxService: MailboxService,
    private readonly s3Service: S3Service,
  ) {}

  @Post('mail/send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.manager)
  sendMail(
    @CurrentUser('id') managerId: string,
    @Body() dto: SendMailDto,
  ) {
    return this.mailboxService.sendMail(managerId, dto, dto.attachments as any);
  }

  @Post('mail/upload-pdf')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.manager)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: pdfFileFilter,
    limits: { fileSize: 20 * 1024 * 1024 },
  }))
  async uploadPdf(
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('PDF file is required');
    }

    const url = await this.s3Service.uploadFile(file, 'mailbox-pdfs');

    return {
      data: {
        url,
        originalName: file.originalname,
        mimeType: file.mimetype,
      },
    };
  }

  @Public()
  @Post('webhook/inbound')
  async inboundWebhook(
    @Req() req: Request & { rawBody?: Buffer | string },
    @Headers('svix-id') svixId?: string,
    @Headers('webhook-id') webhookId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('webhook-timestamp') webhookTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
    @Headers('webhook-signature') webhookSignature?: string,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString('utf8')
      : req.rawBody;

    return this.mailboxService.handleInboundWebhook(rawBody, {
      id: svixId ?? webhookId,
      timestamp: svixTimestamp ?? webhookTimestamp,
      signature: svixSignature ?? webhookSignature,
    });
  }

  @Get('mailbox')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.manager)
  listMailbox(
    @CurrentUser('id') managerId: string,
    @Query('status') status?: string,
    @Query('starred') starred?: string,
  ) {
    return this.mailboxService.listMailbox(managerId, status, starred);
  }

  @Get('mailbox/:conversationId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.manager)
  getConversation(
    @CurrentUser('id') managerId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.mailboxService.getConversation(managerId, conversationId);
  }

  @Patch('mailbox/:conversationId/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.manager)
  updateStatus(
    @CurrentUser('id') managerId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateMailboxStatusDto,
  ) {
    return this.mailboxService.updateStatus(managerId, conversationId, dto.status);
  }

  @Patch('mailbox/:conversationId/star')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.manager)
  toggleStar(
    @CurrentUser('id') managerId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.mailboxService.toggleStar(managerId, conversationId);
  }
}
