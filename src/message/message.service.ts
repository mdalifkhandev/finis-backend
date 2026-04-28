import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDirectThreadDto,
  CreateGroupThreadDto,
  SendMessageDto,
  ThreadQueryDto,
  MessageQueryDto,
  AddParticipantDto,
} from './dto/message.dto';

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────
  // THREADS
  // ─────────────────────────────────────────────

  /** Get all threads for current user with last message & unread count */
  async getMyThreads(userId: string, query: ThreadQueryDto) {
    const { type, search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const threads = await this.prisma.messageThread.findMany({
      where: {
        isActive: true,
        participants: {
          some: { userId },
        },
        ...(type && { type }),
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: {
            content: true,
            sentAt: true,
            senderId: true,
            isRead: true,
          },
        },
      },
    });

    // Attach unread count & filter by search
    const threadsWithMeta = threads
      .map((thread) => {
        const otherParticipants = thread.participants.filter((p) => p.userId !== userId);
        const displayName =
          thread.type === 'direct'
            ? otherParticipants[0]?.user?.fullName ?? 'Unknown'
            : thread.name ?? 'Group';

        const unreadCount = thread.messages.filter(
          (m) => !m.isRead && m.senderId !== userId,
        ).length;

        return {
          id: thread.id,
          type: thread.type,
          name: displayName,
          projectId: thread.projectId,
          isActive: thread.isActive,
          lastMessage: thread.messages[0] ?? null,
          unreadCount,
          participants: otherParticipants.map((p) => p.user),
        };
      })
      .filter((t) => {
        if (!search) return true;
        return t.name.toLowerCase().includes(search.toLowerCase());
      });

    return {
      data: threadsWithMeta,
      meta: { page, limit, total: threadsWithMeta.length },
    };
  }

  /** Get single thread detail */
  async getThreadById(threadId: string, userId: string) {
    const thread = await this.prisma.messageThread.findFirst({
      where: {
        id: threadId,
        participants: { some: { userId } },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }

  /** Create a direct (1-to-1) thread */
  async createDirectThread(userId: string, dto: CreateDirectThreadDto) {
    if (userId === dto.targetUserId) {
      throw new BadRequestException('Cannot create a thread with yourself');
    }

    // Check if direct thread already exists between these two users
    const existing = await this.prisma.messageThread.findFirst({
      where: {
        type: 'direct',
        participants: { some: { userId } },
      },
      include: { participants: true },
    });

    if (existing) {
      const isExisting = existing.participants.some((p) => p.userId === dto.targetUserId);
      if (isExisting) return existing;
    }

    return this.prisma.messageThread.create({
      data: {
        type: 'direct',
        participants: {
          create: [{ userId }, { userId: dto.targetUserId }],
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          },
        },
      },
    });
  }

  /** Create a group or project thread */
  async createGroupThread(userId: string, dto: CreateGroupThreadDto) {
    const allParticipantIds = [...new Set([userId, ...dto.participantIds])];

    return this.prisma.messageThread.create({
      data: {
        type: dto.projectId ? 'project' : 'group',
        name: dto.name,
        projectId: dto.projectId ?? null,
        participants: {
          create: allParticipantIds.map((id) => ({
            userId: id,
            role: id === userId ? 'admin' : 'member',
          })),
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          },
        },
      },
    });
  }

  /** Close/deactivate a thread (Super Admin only) */
  async closeThread(threadId: string) {
    const thread = await this.prisma.messageThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Thread not found');

    return this.prisma.messageThread.update({
      where: { id: threadId },
      data: { isActive: false },
    });
  }

  /** Add participants to a group thread */
  async addParticipants(threadId: string, userId: string, dto: AddParticipantDto) {
    const thread = await this.prisma.messageThread.findFirst({
      where: { id: threadId, participants: { some: { userId, role: 'admin' } } },
    });
    if (!thread) throw new ForbiddenException('Only group admins can add participants');

    await this.prisma.threadParticipant.createMany({
      data: dto.userIds.map((id) => ({ threadId, userId: id, role: 'member' })),
      skipDuplicates: true,
    });

    return { message: 'Participants added successfully' };
  }

  /** Remove a participant from group thread */
  async removeParticipant(threadId: string, requesterId: string, targetUserId: string) {
    const isAdmin = await this.prisma.threadParticipant.findFirst({
      where: { threadId, userId: requesterId, role: 'admin' },
    });
    if (!isAdmin && requesterId !== targetUserId) {
      throw new ForbiddenException('Only admins can remove participants');
    }

    await this.prisma.threadParticipant.deleteMany({
      where: { threadId, userId: targetUserId },
    });

    return { message: 'Participant removed' };
  }

  // ─────────────────────────────────────────────
  // MESSAGES
  // ─────────────────────────────────────────────

  /** Get paginated messages in a thread */
  async getMessages(threadId: string, userId: string, query: MessageQueryDto) {
    const { page = 1, limit = 30 } = query;

    // Verify user is participant
    const isParticipant = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!isParticipant) throw new ForbiddenException('You are not a participant of this thread');

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { threadId },
        orderBy: { sentAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sender: {
            include: {
              user: {
                select: { id: true, fullName: true, avatarUrl: true, role: true },
              },
            },
          },
        },
      }),
      this.prisma.message.count({ where: { threadId } }),
    ]);

    // Mark as read
    await this.prisma.message.updateMany({
      where: { threadId, senderId: { not: userId }, isRead: false },
      data: { isRead: true },
    });

    return {
      data: messages,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Send a message (used by REST & Socket) */
  async sendMessage(senderId: string, dto: SendMessageDto) {
    const { threadId, content, mediaUrl, mediaType } = dto;

    if (!content && !mediaUrl) {
      throw new BadRequestException('Message must have content or media');
    }

    // Verify sender is participant
    const isParticipant = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId: senderId } },
    });
    if (!isParticipant) throw new ForbiddenException('You are not a participant of this thread');

    // Ensure MessageParticipant record exists
    await this.prisma.messageParticipant.upsert({
      where: { userId: senderId },
      update: {},
      create: { userId: senderId },
    });

    const message = await this.prisma.message.create({
      data: {
        threadId,
        senderId,
        content: content ?? null,
        mediaUrl: mediaUrl ?? null,
        mediaType: mediaType ?? null,
        isRead: false,
      },
      include: {
        sender: {
          include: {
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
      },
    });

    return message;
  }

  /** Delete a message (sender only) */
  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('Cannot delete others messages');

    await this.prisma.message.delete({ where: { id: messageId } });
    return { message: 'Message deleted' };
  }

  /** Export thread messages as plain array (Super Admin) */
  async exportThread(threadId: string) {
    const messages = await this.prisma.message.findMany({
      where: { threadId },
      orderBy: { sentAt: 'asc' },
      include: {
        sender: {
          include: {
            user: { select: { fullName: true, role: true } },
          },
        },
      },
    });

    return messages.map((m) => ({
      sender: m.sender?.user?.fullName ?? 'Unknown',
      role: m.sender?.user?.role ?? '',
      content: m.content,
      mediaUrl: m.mediaUrl,
      sentAt: m.sentAt,
    }));
  }

  // ─────────────────────────────────────────────
  // SUPER ADMIN — All threads
  // ─────────────────────────────────────────────

  /** Super admin: get ALL threads across system */
  async getAllThreads(query: ThreadQueryDto) {
    const { type, search, page = 1, limit = 20 } = query;

    const threads = await this.prisma.messageThread.findMany({
      where: {
        ...(type && { type }),
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        participants: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          },
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
    });

    const filtered = threads.filter((t) => {
      if (!search) return true;
      const names = t.participants.map((p) => p.user.fullName).join(' ');
      return (
        names.toLowerCase().includes(search.toLowerCase()) ||
        (t.name ?? '').toLowerCase().includes(search.toLowerCase())
      );
    });

    return {
      data: filtered,
      meta: { page, limit, total: filtered.length },
    };
  }
}