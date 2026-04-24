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
import { PrismaService } from '../../prisma/prisma.service';

// ─── Helper: check if point is inside circle ─────────────────────────────────
function getDistanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/geofencing',
})
export class GeofencingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  // Track connected users: socketId → userId
  private connectedUsers = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ─── CONNECTION ────────────────────────────────────────────────────────────
  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.emit('error', { message: 'No token provided' });
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, fullName: true, role: true, status: true },
      });

      if (!user || user.status !== 'active') {
        client.emit('error', { message: 'Unauthorized' });
        client.disconnect();
        return;
      }

      // Store user info in socket
      client.data.user = user;
      this.connectedUsers.set(client.id, user.id);

      // Admin/super_admin joins admin room for broadcasts
      if (user.role === 'admin' || user.role === 'super_admin') {
        client.join(`admin_${user.id}`);
      }

      console.log(`✅ Connected: ${user.fullName} (${user.role}) - ${client.id}`);
      client.emit('connected', { message: 'Connected successfully', userId: user.id });
    } catch {
      client.emit('error', { message: 'Invalid token' });
      client.disconnect();
    }
  }

  // ─── DISCONNECTION ─────────────────────────────────────────────────────────
  async handleDisconnect(client: Socket) {
    const userId = this.connectedUsers.get(client.id);
    if (userId) {
      this.connectedUsers.delete(client.id);
      console.log(`❌ Disconnected: ${userId} - ${client.id}`);
    }
  }

  // ─── JOIN PROJECT ROOM (admin watches a project) ──────────────────────────
  @SubscribeMessage('join_project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    // Verify access
    const project = await this.prisma.project.findFirst({
      where: {
        id: data.projectId,
        company: { ownerId: user.id },
      },
    });

    if (!project) {
      client.emit('error', { message: 'Project not found or no access' });
      return;
    }

    client.join(`project_${data.projectId}`);
    client.emit('joined_project', { projectId: data.projectId });
    console.log(`👁️ ${user.fullName} watching project: ${data.projectId}`);
  }

  // ─── LEAVE PROJECT ROOM ────────────────────────────────────────────────────
  @SubscribeMessage('leave_project')
  handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    client.leave(`project_${data.projectId}`);
    client.emit('left_project', { projectId: data.projectId });
  }

  // ─── WORKER SENDS LOCATION UPDATE ─────────────────────────────────────────
  @SubscribeMessage('location_update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const { lat, lng, projectId } = data;

    // Get active geofences for this project
    const geofences = await this.prisma.geofence.findMany({
      where: { projectId, isActive: true },
    });

    let isInsideAny = false;
    let nearestGeofence: any = null;
    let minDistance = Infinity;

    for (const geo of geofences) {
      const distance = getDistanceMeters(lat, lng, geo.centerLat, geo.centerLng);

      if (distance < minDistance) {
        minDistance = distance;
        nearestGeofence = geo;
      }

      if (distance <= geo.radiusMeters) {
        isInsideAny = true;

        // Log enter event if not already inside
        await this.prisma.locationLog.create({
          data: {
            userId: user.id,
            geofenceId: geo.id,
            lat,
            lng,
            eventType: 'update',
          },
        });
      }
    }

    // Save location log
    const log = await this.prisma.locationLog.create({
      data: {
        userId: user.id,
        geofenceId: isInsideAny ? nearestGeofence?.id : null,
        lat,
        lng,
        eventType: 'update',
      },
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
        geofence: { select: { zoneName: true } },
      },
    });

    // Handle violation if outside all geofences
    if (!isInsideAny && nearestGeofence) {
      const violation = await this.prisma.geofenceViolation.create({
        data: {
          geofenceId: nearestGeofence.id,
          userId: user.id,
          distanceM: minDistance,
          description: `Worker detected ${Math.round(minDistance - nearestGeofence.radiusMeters)}m outside zone`,
          isResolved: false,
        },
      });

      // 🚨 Broadcast violation alert to project room (admins watching)
      this.server.to(`project_${projectId}`).emit('zone_violation', {
        violation: {
          id: violation.id,
          worker: { id: user.id, fullName: user.fullName },
          geofenceName: nearestGeofence.zoneName,
          distanceOutside: Math.round(minDistance - nearestGeofence.radiusMeters),
          occurredAt: violation.occurredAt,
        },
      });
    }

    // 📡 Broadcast worker location to project room (admins watching)
    this.server.to(`project_${projectId}`).emit('worker_location', {
      workerId: user.id,
      workerName: user.fullName,
      lat,
      lng,
      isInsideZone: isInsideAny,
      zoneName: nearestGeofence?.zoneName ?? null,
      distanceFromZone: Math.round(minDistance),
      timestamp: new Date(),
    });

    // Confirm to worker
    client.emit('location_received', {
      isInsideZone: isInsideAny,
      message: isInsideAny ? 'You are inside the zone' : '⚠️ You are outside the zone',
    });
  }

  // ─── WORKER CHECKS IN (enter zone) ────────────────────────────────────────
  @SubscribeMessage('check_in')
  async handleCheckIn(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const { lat, lng, projectId } = data;

    const geofences = await this.prisma.geofence.findMany({
      where: { projectId, isActive: true },
    });

    let checkedInZone: any = null;

    for (const geo of geofences) {
      const distance = getDistanceMeters(lat, lng, geo.centerLat, geo.centerLng);
      if (distance <= geo.radiusMeters) {
        checkedInZone = geo;

        await this.prisma.locationLog.create({
          data: {
            userId: user.id,
            geofenceId: geo.id,
            lat,
            lng,
            eventType: 'enter',
          },
        });
        break;
      }
    }

    // Update attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.attendance.upsert({
      where: { userId_date: { userId: user.id, date: today } },
      create: {
        userId: user.id,
        date: today,
        checkInTime: new Date(),
        status: 'present',
      },
      update: {
        checkInTime: new Date(),
        status: 'present',
      },
    });

    const payload = {
      worker: { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl },
      zoneName: checkedInZone?.zoneName ?? 'Unknown Zone',
      isInsideZone: !!checkedInZone,
      checkInTime: new Date(),
    };

    // Broadcast to project room
    this.server.to(`project_${projectId}`).emit('worker_checked_in', payload);

    client.emit('check_in_confirmed', {
      message: checkedInZone
        ? `Checked in to ${checkedInZone.zoneName}`
        : '⚠️ Checked in but outside zone boundaries',
      ...payload,
    });
  }

  // ─── WORKER CHECKS OUT (exit zone) ────────────────────────────────────────
  @SubscribeMessage('check_out')
  async handleCheckOut(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const { lat, lng, projectId } = data;

    const geofences = await this.prisma.geofence.findMany({
      where: { projectId, isActive: true },
    });

    for (const geo of geofences) {
      await this.prisma.locationLog.create({
        data: {
          userId: user.id,
          geofenceId: geo.id,
          lat,
          lng,
          eventType: 'exit',
        },
      });
    }

    // Update attendance checkout
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId: user.id, date: today } },
    });

    if (attendance?.checkInTime) {
      const hoursWorked =
        (new Date().getTime() - attendance.checkInTime.getTime()) / (1000 * 60 * 60);

      await this.prisma.attendance.update({
        where: { userId_date: { userId: user.id, date: today } },
        data: {
          checkOutTime: new Date(),
          hoursWorked: Math.round(hoursWorked * 100) / 100,
        },
      });
    }

    const payload = {
      worker: { id: user.id, fullName: user.fullName },
      checkOutTime: new Date(),
    };

    this.server.to(`project_${projectId}`).emit('worker_checked_out', payload);

    client.emit('check_out_confirmed', {
      message: 'Checked out successfully',
      ...payload,
    });
  }

  // ─── GET LIVE WORKERS (admin requests current status) ─────────────────────
  @SubscribeMessage('get_live_workers')
  async handleGetLiveWorkers(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const workers = await this.prisma.attendance.findMany({
      where: {
        date: today,
        status: 'present',
        checkInTime: { not: null },
        checkOutTime: null,
      },
      include: {
        user: {
          select: { id: true, fullName: true, avatarUrl: true, role: true },
        },
      },
    });

    const geofenceViolations = await this.prisma.geofenceViolation.count({
      where: {
        geofence: { projectId: data.projectId },
        isResolved: false,
      },
    });

    client.emit('live_workers', {
      workersOnSite: workers.length,
      outsideZone: geofenceViolations,
      workers: workers.map((a) => ({
        id: a.user.id,
        fullName: a.user.fullName,
        avatarUrl: a.user.avatarUrl,
        checkInTime: a.checkInTime,
      })),
    });
  }

  // ─── RESOLVE VIOLATION ─────────────────────────────────────────────────────
  @SubscribeMessage('resolve_violation')
  async handleResolveViolation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { violationId: string },
  ) {
    const user = client.data.user;
    if (!user || !['admin', 'super_admin'].includes(user.role)) return;

    await this.prisma.geofenceViolation.update({
      where: { id: data.violationId },
      data: { isResolved: true },
    });

    client.emit('violation_resolved', { violationId: data.violationId });
  }
}