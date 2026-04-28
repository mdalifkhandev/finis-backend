import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Ray casting algorithm — point inside polygon check ───────────────────────
function pointInPolygon(
  lat: number,
  lng: number,
  coords: { lat: number; lng: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i].lat, yi = coords[i].lng;
    const xj = coords[j].lat, yj = coords[j].lng;
    if (
      yi > lng !== yj > lng &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

// ─── Parse polygonCoords safely ───────────────────────────────────────────────
function parsePolygonCoords(raw: any): { lat: number; lng: number }[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
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
        // ✅ avatarUrl যোগ করা হয়েছে
        select: {
          id: true,
          fullName: true,
          role: true,
          status: true,
          avatarUrl: true,
        },
      });

      if (!user || user.status !== 'active') {
        client.emit('error', { message: 'Unauthorized' });
        client.disconnect();
        return;
      }

      client.data.user = user;
      this.connectedUsers.set(client.id, user.id);

      if (user.role === 'admin' || user.role === 'super_admin') {
        client.join(`admin_${user.id}`);
      }

      console.log(`✅ Connected: ${user.fullName} (${user.role}) - ${client.id}`);
      client.emit('connected', {
        message: 'Connected successfully',
        userId: user.id,
      });
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

  // ─── JOIN PROJECT ROOM ────────────────────────────────────────────────────
  @SubscribeMessage('join_project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

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

  // ─── LEAVE PROJECT ROOM ───────────────────────────────────────────────────
  @SubscribeMessage('leave_project')
  handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    client.leave(`project_${data.projectId}`);
    client.emit('left_project', { projectId: data.projectId });
  }

  // ─── LOCATION UPDATE ──────────────────────────────────────────────────────
  @SubscribeMessage('location_update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const { lat, lng, projectId } = data;

    const geofences = await this.prisma.geofence.findMany({
      where: { projectId, isActive: true },
    });

    let isInsideAny = false;
    let nearestGeofence: any = null;

    // ✅ Loop যোগ করা হয়েছে — polygon check করে inside/outside বের করে
    for (const geo of geofences) {
      const polygonCoords = parsePolygonCoords(geo.polygonCoords);
      const inside =
        polygonCoords.length >= 3
          ? pointInPolygon(lat, lng, polygonCoords)
          : false;

      if (inside) {
        isInsideAny = true;
        nearestGeofence = geo;

        await this.prisma.locationLog.create({
          data: {
            userId: user.id,
            geofenceId: geo.id,
            lat,
            lng,
            eventType: 'update',
          },
        });
        break; // একটা zone-এ ঢুকলেই যথেষ্ট
      }

      // outside হলে nearest track করো
      if (!nearestGeofence) {
        nearestGeofence = geo;
      }
    }

    // outside হলে একটাই log
    if (!isInsideAny) {
      await this.prisma.locationLog.create({
        data: {
          userId: user.id,
          geofenceId: nearestGeofence?.id ?? null,
          lat,
          lng,
          eventType: 'update',
        },
      });
    }

    // ✅ Violation — radiusMeters বাদ, polygon-based description
    if (!isInsideAny && nearestGeofence) {
      const violation = await this.prisma.geofenceViolation.create({
        data: {
          geofenceId: nearestGeofence.id,
          userId: user.id,
          distanceM: 0,
          description: `Worker is outside the zone: ${nearestGeofence.zoneName}`,
          isResolved: false,
        },
      });

      this.server.to(`project_${projectId}`).emit('zone_violation', {
        violation: {
          id: violation.id,
          worker: { id: user.id, fullName: user.fullName },
          geofenceName: nearestGeofence.zoneName,
          occurredAt: violation.occurredAt,
        },
      });
    }

    this.server.to(`project_${projectId}`).emit('worker_location', {
      workerId: user.id,
      workerName: user.fullName,
      lat,
      lng,
      isInsideZone: isInsideAny,
      zoneName: nearestGeofence?.zoneName ?? null,
      timestamp: new Date(),
    });

    client.emit('location_received', {
      isInsideZone: isInsideAny,
      message: isInsideAny
        ? 'You are inside the zone'
        : '⚠️ You are outside the zone',
    });
  }

  // ─── CHECK IN ─────────────────────────────────────────────────────────────
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
    let isInsideAny = false;

    for (const geo of geofences) {
      const polygonCoords = parsePolygonCoords(geo.polygonCoords);
      const insidePolygon =
        polygonCoords.length >= 3
          ? pointInPolygon(lat, lng, polygonCoords)
          : false;

      if (insidePolygon) {
        isInsideAny = true;
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.upsert({
      where: { userId_date: { userId: user.id, date: today } },
      create: { userId: user.id, date: today, status: 'present' },
      update: { status: 'present' },
    });

    await this.prisma.attendanceSession.create({
      data: {
        attendanceId: attendance.id,
        checkInTime: new Date(),
        inLat: lat,
        inLng: lng,
      },
    });

    const payload = {
      worker: {
        id: user.id,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl, // ✅ এখন কাজ করবে
      },
      zoneName: checkedInZone?.zoneName ?? 'Unknown Zone',
      isInsideZone: isInsideAny,
      checkInTime: new Date(),
    };

    this.server.to(`project_${projectId}`).emit('worker_checked_in', payload);

    client.emit('check_in_confirmed', {
      message: checkedInZone
        ? `Checked in to ${checkedInZone.zoneName}`
        : '⚠️ Checked in but outside zone boundaries',
      ...payload,
    });
  }

  // ─── CHECK OUT ────────────────────────────────────────────────────────────
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.findUnique({
      where: { userId_date: { userId: user.id, date: today } },
      include: {
        sessions: {
          where: { checkOutTime: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const openSession = attendance?.sessions?.[0];

    if (openSession) {
      const hoursWorked =
        (new Date().getTime() - openSession.checkInTime.getTime()) /
        (1000 * 60 * 60);
      const rounded = Math.round(hoursWorked * 100) / 100;

      await this.prisma.attendanceSession.update({
        where: { id: openSession.id },
        data: {
          checkOutTime: new Date(),
          hoursWorked: rounded,
          outLat: lat,
          outLng: lng,
        },
      });

      await this.prisma.attendance.update({
        where: { id: attendance!.id },
        data: {
          totalHours: (attendance!.totalHours ?? 0) + rounded,
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

  // ─── GET LIVE WORKERS ─────────────────────────────────────────────────────
  @SubscribeMessage('get_live_workers')
  async handleGetLiveWorkers(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendances = await this.prisma.attendance.findMany({
      where: {
        date: today,
        status: 'present',
        sessions: { some: { checkOutTime: null } },
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        sessions: {
          where: { checkOutTime: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
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
      workersOnSite: attendances.length,
      outsideZone: geofenceViolations,
      workers: attendances.map((a) => ({
        id: a.user.id,
        fullName: a.user.fullName,
        avatarUrl: a.user.avatarUrl,
        checkInTime: a.sessions[0]?.checkInTime ?? null,
      })),
    });
  }
}