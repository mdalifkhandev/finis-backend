import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { onlineUsers } from './message-presence.store';
import {
  CreateDirectThreadDto,
  SendMessageDto,
  ThreadQueryDto,
  MessageQueryDto,
  AddParticipantDto,
  AdminSendMessageDto,
} from './dto/message.dto';

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) { }

  private getPresence(userId: string, lastActiveAt?: Date | null) {
    return {
      isOnline: onlineUsers.has(userId),
      lastActiveAt: lastActiveAt ?? null,
    };
  }

  // ─────────────────────────────────────────────
  // CONTACTS
  // ─────────────────────────────────────────────

  async getChatContacts(userId: string, userRole: string, search?: string) {
    const roleFilter: Record<string, any> = {
      admin: { notIn: ['super_admin'] },
      manager: { in: ['admin', 'worker'] },
      worker: { equals: 'manager' },
    };

    const contacts = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        status: 'active',
        role: roleFilter[userRole] ?? { notIn: ['super_admin'] },
        ...(search && {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        status: true,
      },
      orderBy: { fullName: 'asc' },
    });

    return contacts.map((user) => ({
      ...user,
      ...this.getPresence(user.id, null),
    }));
  }

  async searchUsersForSupport(search?: string) {
    const term = search?.trim();
    const contacts = await this.prisma.user.findMany({
      where: {
        role: { not: 'super_admin' },
        ...(term && {
          OR: [
            { fullName: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        status: true,
      },
      orderBy: { fullName: 'asc' },
      take: 100,
    });

    return contacts.map((user) => ({
      ...user,
      ...this.getPresence(user.id, null),
    }));
  }

  // ─────────────────────────────────────────────
  // USER — CHAT THREADS (user-to-user, no super_admin)
  // ─────────────────────────────────────────────

  async getUserChatThreads(userId: string, query: ThreadQueryDto) {
    const { search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const threads = await this.prisma.messageThread.findMany({
      where: {
        isActive: true,
        type: 'direct',
        participants: { some: { userId } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { content: true, sentAt: true, senderId: true, isRead: true },
        },
      },
    });

    const filtered = threads
      .filter((thread) => {
        // শুধু user-to-user thread — কোনো super_admin নেই
        const others = thread.participants.filter((p) => p.userId !== userId);
        return others.every((p) => p.user.role !== 'super_admin');
      })
      .filter((thread) => {
        if (!search) return true;
        const others = thread.participants.filter((p) => p.userId !== userId);
        const name = others[0]?.user?.fullName ?? '';
        return name.toLowerCase().includes(search.toLowerCase());
      })
      .map((thread) => {
        const others = thread.participants.filter((p) => p.userId !== userId);
        const unreadCount = thread.messages.filter(
          (m) => !m.isRead && m.senderId !== userId,
        ).length;
        return {
          id: thread.id,
          type: thread.type,
          name: others[0]?.user?.fullName ?? 'Unknown',
          isActive: thread.isActive,
          lastMessage: thread.messages[0] ?? null,
          unreadCount,
          participants: others.map((p) => ({
            ...p.user,
            ...this.getPresence(p.user.id, null),
          })),
          isReadOnly: false,
        };
      });

    return {
      data: filtered,
      meta: { page, limit, total: filtered.length },
    };
  }

  // ─────────────────────────────────────────────
  // USER — SUPPORT THREAD (user ↔ super_admin)
  // ─────────────────────────────────────────────

  async getUserSupportThread(userId: string) {
    const superAdmin = await this.prisma.user.findFirst({
      where: { role: 'super_admin', status: 'active' },
      select: { id: true },
    });
    if (!superAdmin) throw new NotFoundException('Support not available');

    const thread = await this.prisma.messageThread.findFirst({
      where: {
        type: 'direct',
        isActive: true,
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: superAdmin.id } } },
        ],
      },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
        messages: { orderBy: { sentAt: 'desc' }, take: 1 },
      },
    });

    // Thread না থাকলে null return করব, frontend create করবে
    if (!thread) return { data: null };

    const others = thread.participants.filter((p) => p.userId !== userId);
    return {
      data: {
        id: thread.id,
        type: thread.type,
        name: others[0]?.user?.fullName ?? 'Support',
        isActive: thread.isActive,
        lastMessage: thread.messages[0] ?? null,
        unreadCount: 0,
        participants: others.map((p) => ({
          ...p.user,
          ...this.getPresence(p.user.id, null),
        })),
        isReadOnly: false,
      },
    };
  }

  // ─────────────────────────────────────────────
  // USER — CREATE / GET SUPPORT THREAD
  // ─────────────────────────────────────────────

  async getOrCreateSupportThread(requesterId: string, targetUserId?: string) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { role: true },
    });

    let userSideId: string;
    let superAdminId: string;

    if (requester?.role === 'super_admin') {
      if (!targetUserId) throw new BadRequestException('targetUserId is required for super_admin');
      const target = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { role: true },
      });
      if (target?.role === 'super_admin') {
        throw new BadRequestException('Cannot create support thread with another super_admin');
      }
      userSideId = targetUserId;
      superAdminId = requesterId;
    } else {
      const superAdmin = await this.prisma.user.findFirst({
        where: { role: 'super_admin', status: 'active' },
        select: { id: true },
      });
      if (!superAdmin) throw new NotFoundException('Support not available');
      userSideId = requesterId;
      superAdminId = superAdmin.id;
    }

    const existing = await this.prisma.messageThread.findFirst({
      where: {
        type: 'direct',
        isActive: true,
        AND: [
          { participants: { some: { userId: userSideId } } },
          { participants: { some: { userId: superAdminId } } },
        ],
      },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
        messages: { orderBy: { sentAt: 'desc' }, take: 1 },
      },
    });
    if (existing) return existing;

    return this.prisma.messageThread.create({
      data: {
        type: 'direct',
        participants: {
          create: [{ userId: userSideId }, { userId: superAdminId }],
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
        messages: { orderBy: { sentAt: 'desc' }, take: 1 },
      },
    });
  }

  // ─────────────────────────────────────────────
  // USER — CREATE DIRECT CHAT THREAD
  // ─────────────────────────────────────────────

  async createDirectThread(userId: string, dto: CreateDirectThreadDto) {
    if (userId === dto.targetUserId) {
      throw new BadRequestException('Cannot create a thread with yourself');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.targetUserId },
      select: { role: true },
    });

    if (targetUser?.role === 'super_admin') {
      throw new ForbiddenException('Use the Support tab to contact the administrator');
    }

    const existing = await this.prisma.messageThread.findFirst({
      where: {
        type: 'direct',
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: dto.targetUserId } } },
        ],
      },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
      },
    });
    if (existing) return existing;

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
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
      },
    });
  }

  // ─────────────────────────────────────────────
  // SUPER ADMIN — SUPPORT THREADS
  // ─────────────────────────────────────────────

  async getAdminSupportThreads(adminId: string, query: ThreadQueryDto) {
    const { search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const threads = await this.prisma.messageThread.findMany({
      where: {
        type: 'direct',
        participants: {
          some: { userId: adminId },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { content: true, sentAt: true, senderId: true, isRead: true },
        },
      },
    });

    const filtered = threads
      .filter((thread) => {
        // Support thread = super_admin + non-super_admin participant আছে
        const roles = thread.participants.map((p) => p.user.role);
        return roles.includes('super_admin') && roles.some((r) => r !== 'super_admin');
      })
      .filter((thread) => {
        if (!search) return true;
        const names = thread.participants.map((p) => p.user.fullName).join(' ');
        return names.toLowerCase().includes(search.toLowerCase());
      })
      .map((thread) => {
        const others = thread.participants.filter((p) => p.userId !== adminId);
        const unreadCount = thread.messages.filter(
          (m) => !m.isRead && m.senderId !== adminId,
        ).length;
        return {
          id: thread.id,
          type: thread.type,
          name: others[0]?.user?.fullName ?? 'Unknown',
          isActive: thread.isActive,
          lastMessage: thread.messages[0] ?? null,
          unreadCount,
        participants: others.map((p) => ({
          ...p.user,
          ...this.getPresence(p.user.id, null),
        })),
          isReadOnly: false,
        };
      });

    return {
      data: filtered,
      meta: { page, limit, total: filtered.length },
    };
  }

  // ─────────────────────────────────────────────
  // SUPER ADMIN — CHAT THREADS (read only)
  // ─────────────────────────────────────────────

  async getAdminChatThreads(query: ThreadQueryDto) {
    const { search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const threads = await this.prisma.messageThread.findMany({
      where: { type: 'direct' },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { content: true, sentAt: true, senderId: true, isRead: true },
        },
      },
    });

    const filtered = threads
      .filter((thread) => {
        // Chat thread = super_admin নেই
        const roles = thread.participants.map((p) => p.user.role);
        return !roles.includes('super_admin');
      })
      .filter((thread) => {
        if (!search) return true;
        const names = thread.participants.map((p) => p.user.fullName).join(' ');
        return names.toLowerCase().includes(search.toLowerCase());
      })
      .map((thread) => {
        const participants = thread.participants.map((p) => ({
          ...p.user,
          ...this.getPresence(p.user.id, null),
        }));
        return {
          id: thread.id,
          type: thread.type,
          name: participants.map((p) => p.fullName).join(', '),
          isActive: thread.isActive,
          lastMessage: thread.messages[0] ?? null,
          unreadCount: 0,
          participants,
          isReadOnly: true, // super_admin chat thread এ শুধু read করতে পারবে
        };
      });

    return {
      data: filtered,
      meta: { page, limit, total: filtered.length },
    };
  }

  async getAdminChatThreadMessages(threadId: string, query: MessageQueryDto) {
    const { page = 1, limit = 30 } = query;

    const thread = await this.prisma.messageThread.findFirst({
      where: {
        id: threadId,
        type: 'direct',
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

    const roles = thread.participants.map((p) => p.user.role);
    const isChatThread = !roles.includes('super_admin');
    if (!isChatThread) {
      throw new ForbiddenException('This endpoint is only for read-only chat threads');
    }

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { threadId },
        orderBy: { sentAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
            sender: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: true,
              },
            },
        },
      }),
      this.prisma.message.count({ where: { threadId } }),
    ]);

    return {
      data: messages,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────
  // THREAD DETAIL
  // ─────────────────────────────────────────────

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
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { content: true, sentAt: true, senderId: true, isRead: true },
        },
      },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }

  // ─────────────────────────────────────────────
  // MESSAGES
  // ─────────────────────────────────────────────

  async getMessages(threadId: string, userId: string, query: MessageQueryDto) {
    const { page = 1, limit = 30 } = query;

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
            select: { id: true, fullName: true, avatarUrl: true, role: true },
          },
        },
      }),
      this.prisma.message.count({ where: { threadId } }),
    ]);

    // Read mark করা
    await this.prisma.message.updateMany({
      where: { threadId, senderId: { not: userId }, isRead: false },
      data: { isRead: true },
    });

    return {
      data: messages,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────
  // SEND MESSAGE — USER
  // ─────────────────────────────────────────────

  async sendMessage(senderId: string, dto: SendMessageDto) {
    const { threadId, content, mediaUrl, mediaType } = dto;

    if (!content && !mediaUrl) {
      throw new BadRequestException('Message must have content or media');
    }

    const isParticipant = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId: senderId } },
    });
    if (!isParticipant) throw new ForbiddenException('You are not a participant of this thread');

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { role: true },
    });

    // super_admin শুধু support thread এ message পাঠাতে পারবে
    if (sender?.role === 'super_admin') {
      const thread = await this.prisma.messageThread.findUnique({
        where: { id: threadId },
        include: {
          participants: {
            include: { user: { select: { id: true, role: true } } },
          },
        },
      });
      const otherParticipants = thread?.participants.filter((p) => p.userId !== senderId);
      const allOthersAreSuperAdmin = otherParticipants?.every(
        (p) => p.user.role === 'super_admin',
      );
      if (allOthersAreSuperAdmin) {
        throw new ForbiddenException('Super admin can only send messages in Support threads');
      }
    }


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
          select: { id: true, fullName: true, avatarUrl: true, role: true },
        },
      },
    });

    await this.notifyUnreadThreadParticipants(threadId, senderId, message.content ?? 'New message');
    return message;
  }

  // ─────────────────────────────────────────────
  // SEND MESSAGE — SUPER ADMIN (support only)
  // ─────────────────────────────────────────────

  async sendAdminSupportMessage(adminId: string, dto: AdminSendMessageDto) {
    const { threadId, content, mediaUrl, mediaType } = dto;

    if (!content && !mediaUrl) {
      throw new BadRequestException('Message must have content or media');
    }

    // Thread verify — super_admin participant কিনা
    const isParticipant = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId: adminId } },
    });
    if (!isParticipant) throw new ForbiddenException('You are not a participant of this thread');

    // Thread টা support thread কিনা verify
    const thread = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
      include: {
        participants: {
          include: { user: { select: { id: true, role: true } } },
        },
      },
    });

    const otherParticipants = thread?.participants.filter((p) => p.userId !== adminId);
    const isSupportThread = otherParticipants?.some((p) => p.user.role !== 'super_admin');

    if (!isSupportThread) {
      throw new ForbiddenException('Super admin can only send messages in Support threads');
    }


    const message = await this.prisma.message.create({
      data: {
        threadId,
        senderId: adminId,
        content: content ?? null,
        mediaUrl: mediaUrl ?? null,
        mediaType: mediaType ?? null,
        isRead: false,
      },
      include: {
        sender: {
          select: { id: true, fullName: true, avatarUrl: true, role: true },
        },
      },
    });

    await this.notifyUnreadThreadParticipants(threadId, adminId, message.content ?? 'New message');
    return message;
  }

  private async notifyUnreadThreadParticipants(threadId: string, senderId: string, preview: string) {
    const thread = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, fullName: true, role: true },
            },
          },
        },
      },
    });

    const recipients = thread?.participants
      .map((participant) => participant.user)
      .filter((user) => user.id !== senderId) ?? [];

    await Promise.all(
      recipients.map((recipient) =>
        this.notificationsService.send({
          userId: recipient.id,
          title: 'New message',
          body: preview.slice(0, 120),
          type: 'message',
          refType: 'message/thread',
          refId: threadId,
        }),
      ),
    );
  }

  // ─────────────────────────────────────────────
  // CLOSE THREAD
  // ─────────────────────────────────────────────

  async closeThread(threadId: string) {
    const thread = await this.prisma.messageThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Thread not found');
    return this.prisma.messageThread.update({
      where: { id: threadId },
      data: { isActive: false },
    });
  }

  // ─────────────────────────────────────────────
  // EXPORT THREAD
  // ─────────────────────────────────────────────

  async exportThread(threadId: string) {
    const messages = await this.prisma.message.findMany({
      where: { threadId },
      orderBy: { sentAt: 'asc' },
      include: {
        sender: {
          select: { fullName: true, role: true },
        },
      },
    });

    return messages.map((m) => ({
      sender: m.sender?.fullName ?? 'Unknown',
      role: m.sender?.role ?? '',
      content: m.content,
      mediaUrl: m.mediaUrl,
      sentAt: m.sentAt,
    }));
  }

  // ─────────────────────────────────────────────
  // DELETE MESSAGE
  // ─────────────────────────────────────────────

  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('Cannot delete others messages');
    await this.prisma.message.delete({ where: { id: messageId } });
    return { message: 'Message deleted' };
  }
}
