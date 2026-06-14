import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

type NotificationRole = 'super_admin' | 'admin' | 'manager' | 'worker' | 'viewer';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async send(dto: {
    userId?: string;
    targetRole?: NotificationRole;
    title: string;
    body: string;
    type?: string;
    refId?: string;
    refType?: string;
  }) {
    if (dto.targetRole) {
      return this.sendToRole(dto.targetRole, {
        title: dto.title,
        body: dto.body,
        type: dto.type,
        refId: dto.refId,
        refType: dto.refType,
      });
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId!,
        title: dto.title,
        body: dto.body,
        type: (dto.type as any) ?? 'general',
        refId: dto.refId,
        refType: dto.refType,
      },
    });

    if (dto.userId) {
      this.gateway.sendToUser(dto.userId, notification);
    } else {
      this.gateway.broadcastAll(notification);
    }

    await this.sendExpoPush(dto.userId, dto.title, dto.body);
    return notification;
  }

  async sendToRole(
    role: NotificationRole,
    dto: {
      title: string;
      body: string;
      type?: string;
      refId?: string;
      refType?: string;
    },
  ) {
    const users = await this.prisma.user.findMany({
      where: { role },
      select: { id: true },
    });

    if (!users.length) {
      return [];
    }

    const notifications = await this.prisma.$transaction(
      users.map((user) =>
        this.prisma.notification.create({
          data: {
            userId: user.id,
            title: dto.title,
            body: dto.body,
            type: (dto.type as any) ?? 'general',
            refId: dto.refId,
            refType: dto.refType,
          },
        }),
      ),
    );

    notifications.forEach((notification) => {
      this.gateway.sendToUser(notification.userId, notification);
      this.gateway.sendToRole(role, notification);
    });

    await this.sendExpoPushToRole(role, dto.title, dto.body);
    return notifications;
  }

  private async sendExpoPush(
    userId: string | undefined,
    title: string,
    body: string,
  ) {
    try {
      let tokens: string[] = [];

      if (userId) {
        const deviceTokens = await this.prisma.deviceToken.findMany({
          where: { userId },
          select: { token: true },
        });
        tokens = deviceTokens.map((d) => d.token);
      }

      if (!tokens.length) return;

      const messages = tokens.map((token) => ({
        to: token,
        title,
        body,
        sound: 'default',
      }));

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });
    } catch (error) {
      console.error('Expo push error:', error);
    }
  }

  private async sendExpoPushToRole(
    role: NotificationRole,
    title: string,
    body: string,
  ) {
    try {
      const users = await this.prisma.user.findMany({
        where: { role },
        select: { id: true },
      });

      const deviceTokens = await this.prisma.deviceToken.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        select: { token: true },
      });

      const tokens = deviceTokens.map((d) => d.token);
      if (!tokens.length) return;

      const messages = tokens.map((token) => ({
        to: token,
        title,
        body,
        sound: 'default',
      }));

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });
    } catch (error) {
      console.error('Expo push role error:', error);
    }
  }

  async getForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async saveDeviceToken(userId: string, token: string, platform?: string) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async removeDeviceToken(token: string) {
    return this.prisma.deviceToken.delete({ where: { token } });
  }
}
