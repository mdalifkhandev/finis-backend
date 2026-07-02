import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Resend } from 'resend';
import { SendMailDto } from './dto/send-mail.dto';
import { randomUUID } from 'crypto';

type MailboxAttachment = { name: string; url: string; size?: string };
type WebhookHeaders = {
  id?: string;
  timestamp?: string;
  signature?: string;
};
type MailboxUser = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
};

@Injectable()
export class MailboxService {
  private resend: Resend | null = null;
  private readonly fromEmail: string;
  private readonly replyDomain: string;

  constructor(private readonly prisma: PrismaService) {
    this.fromEmail = process.env.MAILBOX_FROM_EMAIL || 'manager@yourdomain.com';
    this.replyDomain = process.env.MAILBOX_REPLY_DOMAIN || 'reply.yourdomain.com';
  }

  private getResendClient() {
    if (this.resend) {
      return this.resend;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('RESEND_API_KEY is not configured');
    }

    this.resend = new Resend(apiKey);
    return this.resend;
  }

  private buildProxyAddress(conversationId: string) {
    return `conv-${conversationId}@${this.replyDomain}`;
  }

  private normalizeAttachments(attachments?: MailboxAttachment[]) {
    if (!attachments?.length) return undefined;

    const valid = attachments.filter(
      (attachment) =>
        !!attachment.url &&
        attachment.url.startsWith('http') &&
        !attachment.url.includes('your-cdn.com'),
    );

    return valid.length
      ? valid.map((attachment) => ({
          filename: attachment.name,
          path: attachment.url,
        }))
      : undefined;
  }

  private extractBodyText(bodyHtml?: string | null, bodyText?: string | null) {
    return bodyText ?? bodyHtml?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  }

  private formatUser(user?: MailboxUser | null) {
    if (!user) return null;

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl ?? null,
    };
  }

  async sendMail(managerId: string, dto: SendMailDto, attachments?: MailboxAttachment[]) {
    const conversationId = randomUUID();
    const proxyAddress = this.buildProxyAddress(conversationId);
    const bodyHtml = `<div>${dto.body.replace(/\n/g, '<br/>')}</div>`;
    const clientName = dto.clientName?.trim() || dto.clientEmail;
    const resend = this.getResendClient();

    const conversation = await this.prisma.conversation.create({
      data: {
        id: conversationId,
        managerId,
        clientEmail: dto.clientEmail,
        clientName,
        proxyAddress,
        status: 'active',
      },
      include: {
        manager: {
          select: { id: true, fullName: true, email: true, role: true, avatarUrl: true },
        },
      },
    });

    await this.prisma.mailboxMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: managerId,
        direction: 'sent',
        fromEmail: this.fromEmail,
        toEmail: dto.clientEmail,
        subject: dto.subject,
        bodyText: dto.body,
        bodyHtml,
        attachments: attachments ?? [],
        isRead: true,
      },
    });

    const payload = {
      from: this.fromEmail,
      to: dto.clientEmail,
      replyTo: proxyAddress,
      subject: dto.subject,
      html: bodyHtml,
      attachments: this.normalizeAttachments(attachments),
    };

    console.log('Mailbox send payload:', {
      from: payload.from,
      to: payload.to,
      replyTo: payload.replyTo,
      subject: payload.subject,
    });

    const { data, error } = await resend.emails.send(payload);

    console.log('Resend response:', data, error);

    if (error) {
      throw new BadRequestException(`Failed to send email: ${error.message}`);
    }

    return {
      conversation,
      proxyAddress,
      sender: this.formatUser(conversation.manager),
    };
  }

  async listMailbox(
    managerId: string,
    status?: string,
    starred?: string,
    page?: string,
    limit?: string,
  ) {
    const pageNumber = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number.parseInt(limit ?? '10', 10) || 10));
    const skip = (pageNumber - 1) * limitNumber;

    const where = {
      managerId,
      ...(status && ['active', 'closed'].includes(status) ? { status } : {}),
      ...(starred != null ? { isStarred: starred === 'true' } : {}),
    };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy: [{ isStarred: 'desc' }, { createdAt: 'desc' }],
        include: {
          manager: {
            select: { id: true, fullName: true, email: true, role: true, avatarUrl: true },
          },
          messages: {
            include: {
              sender: {
                select: { id: true, fullName: true, email: true, role: true, avatarUrl: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const data = conversations.map((conversation) => {
      const latestMessage = conversation.messages[0] ?? null;
      const unreadCount = conversation.messages.filter((message) => !message.isRead && message.direction === 'received').length;

      return {
        id: conversation.id,
        clientEmail: conversation.clientEmail,
        clientName: conversation.clientName,
        proxyAddress: conversation.proxyAddress,
        status: conversation.status,
        isStarred: conversation.isStarred,
        createdAt: conversation.createdAt,
        sender: this.formatUser(conversation.manager),
        unreadCount,
        latestMessage: latestMessage
          ? {
              id: latestMessage.id,
              direction: latestMessage.direction,
              subject: latestMessage.subject,
              preview: this.extractBodyText(latestMessage.bodyHtml, latestMessage.bodyText).slice(0, 160),
              createdAt: latestMessage.createdAt,
              isRead: latestMessage.isRead,
              sender: this.formatUser(latestMessage.sender),
            }
          : null,
      };
    });

    return {
      data,
      meta: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  async getConversation(managerId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, managerId },
      include: {
        manager: {
          select: { id: true, fullName: true, email: true, role: true, avatarUrl: true },
        },
        messages: {
          include: {
            sender: {
              select: { id: true, fullName: true, email: true, role: true, avatarUrl: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.prisma.mailboxMessage.updateMany({
      where: {
        conversationId,
        direction: 'received',
        isRead: false,
      },
      data: { isRead: true },
    });

    return {
      ...conversation,
      sender: this.formatUser(conversation.manager),
      messages: conversation.messages,
    };
  }

  async updateStatus(managerId: string, conversationId: string, status: 'active' | 'closed') {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, managerId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status },
    });
  }

  async toggleStar(managerId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, managerId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { isStarred: !conversation.isStarred },
    });
  }

  async handleInboundWebhook(payload: string | Buffer, headers: WebhookHeaders) {
    const rawBody = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    const resend = this.getResendClient();

    if (!webhookSecret) {
      throw new BadRequestException('RESEND_WEBHOOK_SECRET is not configured');
    }

    if (!headers.id || !headers.timestamp || !headers.signature) {
      throw new BadRequestException('Missing webhook signature');
    }

    let event: any;
    try {
      event = resend.webhooks.verify({
        payload: rawBody,
        headers: {
          id: headers.id,
          timestamp: headers.timestamp,
          signature: headers.signature,
        },
        webhookSecret,
      });
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    const data = event?.data ?? event;
    const to = Array.isArray(data?.to) ? data.to[0] : data?.to;
    const from = Array.isArray(data?.from) ? data.from[0] : data?.from;
    const subject = data?.subject ?? '';
    const bodyText = data?.text ?? data?.bodyText ?? data?.body ?? null;
    const bodyHtml = data?.html ?? data?.bodyHtml ?? null;
    const attachments = (data?.attachments ?? []).map((attachment: any) => ({
      name: attachment?.name ?? attachment?.filename ?? 'attachment',
      url: attachment?.url ?? attachment?.path ?? '',
      size: attachment?.size != null ? String(attachment.size) : undefined,
    })).filter((attachment: MailboxAttachment) => attachment.url);

    if (!to) {
      throw new BadRequestException('Recipient address not found');
    }

    const proxyAddress = String(to).toLowerCase();
    const conversation = await this.prisma.conversation.findUnique({
      where: { proxyAddress },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.prisma.mailboxMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'received',
        fromEmail: from ?? conversation.clientEmail,
        toEmail: conversation.proxyAddress,
        subject,
        bodyText,
        bodyHtml,
        attachments,
        isRead: false,
      },
    });

    return { received: true };
  }
}
