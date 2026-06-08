import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { MessageService } from './message.service';
import { SocketMessageDto } from './dto/message.dto';

// userId → socketId map
const onlineUsers = new Map<string, string>();

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*' },
})
export class MessageGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly messageService: MessageService,
    private readonly jwtService: JwtService,
  ) {}

  // ═════════════════════════════════════════════
  // CONNECTION
  // ═════════════════════════════════════════════

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) throw new WsException('Unauthorized');

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secret',
      });

      client.data.userId = payload.sub || payload.id;
      client.data.role   = payload.role;

      onlineUsers.set(client.data.userId, client.id);

      if (client.data.role === 'super_admin') {
        // super_admin শুধু support threads এ join করবে
        const supportThreads = await this.messageService.getAdminSupportThreads(
          client.data.userId,
          {},
        );
        for (const thread of supportThreads.data) {
          client.join(`thread:${thread.id}`);
        }
      } else {
        // Regular user — নিজের সব threads এ join করবে (chat + support)
        const chatThreads = await this.messageService.getUserChatThreads(
          client.data.userId,
          {},
        );
        for (const thread of chatThreads.data) {
          client.join(`thread:${thread.id}`);
        }

        // Support thread এও join
        const supportThread = await this.messageService.getUserSupportThread(
          client.data.userId,
        );
        if (supportThread.data) {
          client.join(`thread:${supportThread.data.id}`);
        }
      }

      this.server.emit('user:online', { userId: client.data.userId });
      console.log(`✅ Connected: ${client.data.userId} (${client.data.role})`);
    } catch {
      client.disconnect();
    }
  }

  // ═════════════════════════════════════════════
  // DISCONNECT
  // ═════════════════════════════════════════════

  handleDisconnect(client: Socket) {
    if (client.data.userId) {
      onlineUsers.delete(client.data.userId);
      this.server.emit('user:offline', { userId: client.data.userId });
      console.log(`❌ Disconnected: ${client.data.userId}`);
    }
  }

  // ═════════════════════════════════════════════
  // JOIN / LEAVE ROOM
  // ═════════════════════════════════════════════

  @SubscribeMessage('thread:join')
  handleJoinThread(
    @MessageBody() data: { threadId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`thread:${data.threadId}`);
    return { event: 'thread:joined', threadId: data.threadId };
  }

  @SubscribeMessage('thread:leave')
  handleLeaveThread(
    @MessageBody() data: { threadId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`thread:${data.threadId}`);
    return { event: 'thread:left', threadId: data.threadId };
  }

  // ═════════════════════════════════════════════
  // SEND MESSAGE
  //
  // Rules:
  //   super_admin → শুধু support threads এ পাঠাতে পারবে
  //   regular user → নিজের যেকোনো thread এ পাঠাতে পারবে
  // ═════════════════════════════════════════════

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @MessageBody() dto: SocketMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) throw new WsException('Unauthorized');

      let message: any;

      if (client.data.role === 'super_admin') {
        // super_admin এর জন্য আলাদা service method
        message = await this.messageService.sendAdminSupportMessage(userId, {
          threadId:  dto.threadId,
          content:   dto.content,
          mediaUrl:  dto.mediaUrl,
          mediaType: dto.mediaType,
        });
      } else {
        // Regular user
        message = await this.messageService.sendMessage(userId, {
          threadId:  dto.threadId,
          content:   dto.content,
          mediaUrl:  dto.mediaUrl,
          mediaType: dto.mediaType,
        });
      }

      // Thread room এ সবাইকে নতুন message পাঠানো
      this.server
        .to(`thread:${dto.threadId}`)
        .emit('message:new', message);

      // Thread list update করা
      this.server.emit('thread:updated', {
        threadId:    dto.threadId,
        lastMessage: message,
      });

      return { status: 'ok', message };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      client.emit('error', { message: msg });
    }
  }

  // ═════════════════════════════════════════════
  // NEW SUPPORT THREAD
  //
  // User POST /messages/support/thread call করার পরে
  // frontend এই event emit করবে।
  // super_admin এর socket নতুন room এ auto-join করবে।
  // ═════════════════════════════════════════════

  @SubscribeMessage('support:thread:new')
  async handleNewSupportThread(
    @MessageBody() data: { threadId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    // User নিজে নতুন thread room এ join করবে
    client.join(`thread:${data.threadId}`);

    // Thread detail নিয়ে super_admin কে notify করা
    const thread = await this.messageService.getThreadById(data.threadId, userId);
    const participants = thread.participants as Array<{
      userId: string;
      user: { role: string };
    }>;

    const superAdminParticipant = participants.find(
      (p) => p.user.role === 'super_admin',
    );

    if (superAdminParticipant) {
      const superAdminSocketId = onlineUsers.get(superAdminParticipant.userId);

      if (superAdminSocketId) {
        // super_admin এর socket নতুন room এ join করবে
        const superAdminSocket = this.server.sockets.sockets.get(superAdminSocketId);
        superAdminSocket?.join(`thread:${data.threadId}`);

        // super_admin কে নতুন support thread এর notification পাঠানো
        this.server.to(superAdminSocketId).emit('support:thread:new', {
          threadId: data.threadId,
          thread,
        });
      }
    }

    return { event: 'support:thread:joined', threadId: data.threadId };
  }

  // ═════════════════════════════════════════════
  // TYPING INDICATOR
  //
  // super_admin → শুধু support thread এ typing করতে পারবে
  // Regular user → নিজের যেকোনো thread এ
  // ═════════════════════════════════════════════

  @SubscribeMessage('message:typing')
  async handleTyping(
    @MessageBody() data: { threadId: string; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    // super_admin হলে check করতে হবে এটা support thread কিনা
    if (client.data.role === 'super_admin') {
      const thread = await this.messageService.getThreadById(data.threadId, userId);
      const participants = thread.participants as Array<{
        userId: string;
        user: { role: string };
      }>;

      const otherParticipants = participants.filter((p) => p.userId !== userId);
      const isSupportThread = otherParticipants.some(
        (p) => p.user.role !== 'super_admin',
      );

      // Chat thread এ super_admin typing করতে পারবে না
      if (!isSupportThread) return;
    }

    client.to(`thread:${data.threadId}`).emit('message:typing', {
      userId,
      threadId: data.threadId,
      isTyping: data.isTyping,
    });
  }

  // ═════════════════════════════════════════════
  // MARK AS READ
  // ═════════════════════════════════════════════

  @SubscribeMessage('message:read')
  handleMarkRead(
    @MessageBody() data: { threadId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(`thread:${data.threadId}`).emit('message:read', {
      userId:   client.data.userId,
      threadId: data.threadId,
    });
  }

  // ═════════════════════════════════════════════
  // ONLINE STATUS
  // ═════════════════════════════════════════════

  @SubscribeMessage('user:status')
  handleUserStatus(@MessageBody() data: { userIds: string[] }) {
    const statuses: Record<string, boolean> = {};
    for (const id of data.userIds) {
      statuses[id] = onlineUsers.has(id);
    }
    return { event: 'user:status', statuses };
  }

  // ═════════════════════════════════════════════
  // HELPER — specific user কে emit করা
  // ═════════════════════════════════════════════

  emitToUser(userId: string, event: string, data: any) {
    const socketId = onlineUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }
}