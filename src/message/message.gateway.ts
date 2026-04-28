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
import { UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MessageService } from './message.service';
import { SocketMessageDto } from './dto/message.dto';

// Map to track online users: userId -> socketId
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

  // ─────────────────────────────────────────────
  // CONNECTION LIFECYCLE
  // ─────────────────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) throw new WsException('Unauthorized');

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secret',
      });

      // Attach user to socket
      client.data.userId = payload.sub || payload.id;
      client.data.role = payload.role;

      // Track online status
      onlineUsers.set(client.data.userId, client.id);

      // Auto-join all user's threads
      const threads = await this.messageService.getMyThreads(client.data.userId, {});
      for (const thread of threads.data) {
        client.join(`thread:${thread.id}`);
      }

      // Notify others that user is online
      this.server.emit('user:online', { userId: client.data.userId });

      console.log(`✅ Socket connected: ${client.data.userId}`);
    } catch (err) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data.userId) {
      onlineUsers.delete(client.data.userId);
      this.server.emit('user:offline', { userId: client.data.userId });
      console.log(`❌ Socket disconnected: ${client.data.userId}`);
    }
  }

  // ─────────────────────────────────────────────
  // JOIN / LEAVE ROOM
  // ─────────────────────────────────────────────

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

  // ─────────────────────────────────────────────
  // SEND MESSAGE
  // ─────────────────────────────────────────────

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @MessageBody() dto: SocketMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) throw new WsException('Unauthorized');

      const message = await this.messageService.sendMessage(userId, {
        threadId: dto.threadId,
        content: dto.content,
        mediaUrl: dto.mediaUrl,
        mediaType: dto.mediaType,
      });

      // Broadcast to everyone in the thread room (including sender)
      this.server.to(`thread:${dto.threadId}`).emit('message:new', message);

      // Notify thread list update for offline/other users
      this.server.emit('thread:updated', {
        threadId: dto.threadId,
        lastMessage: message,
      });

      return { status: 'ok', message };
    } catch (err) {
      const errorMessage = (err instanceof Error && err.message) ? err.message : 'An error occurred';
      client.emit('error', { message: errorMessage });
    }
  }

  // ─────────────────────────────────────────────
  // TYPING INDICATOR
  // ─────────────────────────────────────────────

  @SubscribeMessage('message:typing')
  handleTyping(
    @MessageBody() data: { threadId: string; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    // Broadcast to others in thread (not the sender)
    client.to(`thread:${data.threadId}`).emit('message:typing', {
      userId: client.data.userId,
      threadId: data.threadId,
      isTyping: data.isTyping,
    });
  }

  // ─────────────────────────────────────────────
  // MARK AS READ
  // ─────────────────────────────────────────────

  @SubscribeMessage('message:read')
  async handleMarkRead(
    @MessageBody() data: { threadId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Notify others that messages are read
    client.to(`thread:${data.threadId}`).emit('message:read', {
      userId: client.data.userId,
      threadId: data.threadId,
    });
  }

  // ─────────────────────────────────────────────
  // ONLINE STATUS CHECK
  // ─────────────────────────────────────────────

  @SubscribeMessage('user:status')
  handleUserStatus(
    @MessageBody() data: { userIds: string[] },
  ) {
    const statuses: Record<string, boolean> = {};
    for (const id of data.userIds) {
      statuses[id] = onlineUsers.has(id);
    }
    return { event: 'user:status', statuses };
  }

  // ─────────────────────────────────────────────
  // HELPER — emit to specific user by userId
  // ─────────────────────────────────────────────

  emitToUser(userId: string, event: string, data: any) {
    const socketId = onlineUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }
}