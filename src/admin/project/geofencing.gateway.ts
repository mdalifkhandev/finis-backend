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

// ─── Haversine distance (meters) ─────────────────────────────────────────────
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Polygon center calculate ─────────────────────────────────────────────────
function polygonCenter(coords: { lat: number; lng: number }[]): {
  lat: number;
  lng: number;
} {
  const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
  return { lat, lng };
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

  // ─── JOIN PROJECT ROOM ─────────────────────────────────────────────────────
@SubscribeMessage('join_project')
async handleJoinProject(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { projectId: string },
) {
  const user = client.data.user;
  if (!user) return;

  // super_admin সব project দেখতে পারবে
  if (user.role === 'super_admin') {
    const project = await this.prisma.project.findUnique({
      where: { id: data.projectId },
    });

    if (!project) {
      client.emit('error', { message: 'Project not found' });
      return;
    }

    client.join(`project_${data.projectId}`);
    client.emit('joined_project', { projectId: data.projectId });
    return;
  }

  // admin/manager — company owner অথবা team member হলে access
  const project = await this.prisma.project.findFirst({
    where: {
      id: data.projectId,
      OR: [
        { company: { ownerId: user.id } },
        { teamMembers: { some: { userId: user.id } } },
      ],
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
        break;
      }

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

    // ─── Violation — actual distance calculate করে save ───────────────────
    if (!isInsideAny && nearestGeofence) {
      const coords = parsePolygonCoords(nearestGeofence.polygonCoords);
      const center =
        coords.length > 0 ? polygonCenter(coords) : { lat, lng };

      const distanceM = Math.round(
        haversineDistance(lat, lng, center.lat, center.lng),
      );

      const violation = await this.prisma.geofenceViolation.create({
        data: {
          geofenceId: nearestGeofence.id,
          userId: user.id,
          distanceM,
          description: `Worker is ${distanceM}m outside the zone: ${nearestGeofence.zoneName}`,
          isResolved: false,
        },
      });

      this.server.to(`project_${projectId}`).emit('zone_violation', {
        violation: {
          id: violation.id,
          worker: { id: user.id, fullName: user.fullName },
          geofenceName: nearestGeofence.zoneName,
          distanceM,
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
        avatarUrl: user.avatarUrl,
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

    const outsideZoneCount = await this.prisma.geofenceViolation.count({
      where: {
        geofence: { projectId: data.projectId },
        isResolved: false,
      },
    });

    client.emit('live_workers', {
      workersOnSite: attendances.length,
      outsideZone: outsideZoneCount,
      workers: attendances.map((a) => ({
        id: a.user.id,
        fullName: a.user.fullName,
        avatarUrl: a.user.avatarUrl,
        checkInTime: a.sessions[0]?.checkInTime ?? null,
      })),
    });
  }

  private async verifyProjectAccess(
    projectId: string,
    userId: string,
    userRole: string,
  ) {
    if (userRole === 'super_admin') {
      return;
    }

    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { company: { ownerId: userId } },
          { teamMembers: { some: { userId } } },
        ],
      },
      select: { id: true },
    });

    if (!project) {
      throw new Error('Project not found or no access');
    }
  }

  async getGeofences(projectId: string, userId: string, userRole: string) {
  await this.verifyProjectAccess(projectId, userId, userRole);

  const geofences = await this.prisma.geofence.findMany({
    where: { projectId },
  });

  return geofences.map((geo) => {
    const coords = geo.polygonCoords
      ? Array.isArray(geo.polygonCoords)
        ? (geo.polygonCoords as { lat: number; lng: number }[])
        : JSON.parse(geo.polygonCoords as string)
      : [];

    const center =
      coords.length > 0
        ? {
            lat: coords.reduce((s: number, c: any) => s + c.lat, 0) / coords.length,
            lng: coords.reduce((s: number, c: any) => s + c.lng, 0) / coords.length,
          }
        : null;

    return {
      ...geo,
      center,   // ← "43.6332° N, -79.4186° W" এর জন্য
    };
  });
}
}