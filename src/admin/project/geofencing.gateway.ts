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

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface WorkerLocationState {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  projectId: string;
  lat: number;
  lng: number;
  isInsideZone: boolean;
  zoneName: string | null;
  timestamp: Date;
  // Time tracking
  zoneEnteredAt: Date | null;       // কখন zone এ ঢুকেছে
  totalZoneSeconds: number;          // মোট zone এ থাকা সময়
  totalOutsideSeconds: number;       // মোট বাইরে থাকা সময়
  outsideStartedAt: Date | null;     // কখন বাইরে গেছে
  hasActiveViolation: boolean;       // violation already আছে কিনা
  sessionId: string | null;          // current attendance session
}

// ─── Ray casting — point inside polygon ──────────────────────────────────────
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

// ─── Parse polygonCoords ──────────────────────────────────────────────────────
function parsePolygonCoords(raw: any): { lat: number; lng: number }[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

// ─── Haversine distance (meters) ─────────────────────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

// ─── Polygon center ───────────────────────────────────────────────────────────
function polygonCenter(coords: { lat: number; lng: number }[]): { lat: number; lng: number } {
  const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
  return { lat, lng };
}

// ─── Seconds to hours (rounded 2 decimal) ────────────────────────────────────
function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/geofencing',
})
export class GeofencingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  // socketId → userId
  private connectedUsers = new Map<string, string>();

  // userId → WorkerLocationState (live workers memory)
  private workerStates = new Map<string, WorkerLocationState>();

  // userId → socketId (reverse lookup)
  private userSockets = new Map<string, string>();

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
      this.userSockets.set(user.id, client.id);

      // Admin/Super Admin → admin room এ join
      if (user.role === 'admin' || user.role === 'super_admin') {
        client.join(`admin_${user.id}`);
        client.emit('connected', { message: 'Connected successfully', userId: user.id });
        console.log(`✅ Admin Connected: ${user.fullName} - ${client.id}`);
        return;
      }

      // Worker → active project auto find করে join
      if (user.role === 'worker' || user.role === 'manager') {
        const projectMember = await this.prisma.projectMember.findFirst({
          where: { userId: user.id },
          include: {
            project: {
              select: { id: true, name: true, status: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (projectMember) {
          const projectId = projectMember.projectId;
          client.data.projectId = projectId;
          client.join(`project_${projectId}`);

          // Worker state initialize
          this.workerStates.set(user.id, {
            userId: user.id,
            fullName: user.fullName,
            avatarUrl: user.avatarUrl,
            projectId,
            lat: 0,
            lng: 0,
            isInsideZone: false,
            zoneName: null,
            timestamp: new Date(),
            zoneEnteredAt: null,
            totalZoneSeconds: 0,
            totalOutsideSeconds: 0,
            outsideStartedAt: new Date(), // শুরুতে বাইরে ধরে নিচ্ছি
            hasActiveViolation: false,
            sessionId: null,
          });

          console.log(`✅ Worker Connected: ${user.fullName} → Project: ${projectMember.project.name}`);
        } else {
          console.log(`✅ Worker Connected (no project): ${user.fullName}`);
        }

        client.emit('connected', {
          message: 'Connected successfully',
          userId: user.id,
          projectId: client.data.projectId ?? null,
        });
      }
    } catch {
      client.emit('error', { message: 'Invalid token' });
      client.disconnect();
    }
  }

  // ─── DISCONNECTION ─────────────────────────────────────────────────────────
  async handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (!user) return;

    const projectId = client.data.projectId;
    const state = this.workerStates.get(user.id);

    if (state && projectId) {
      const now = new Date();

      // Zone এ থাকলে শেষ সময় count করো
      let finalZoneSeconds = state.totalZoneSeconds;
      let finalOutsideSeconds = state.totalOutsideSeconds;

      if (state.isInsideZone && state.zoneEnteredAt) {
        finalZoneSeconds += Math.floor((now.getTime() - state.zoneEnteredAt.getTime()) / 1000);
      } else if (!state.isInsideZone && state.outsideStartedAt) {
        finalOutsideSeconds += Math.floor((now.getTime() - state.outsideStartedAt.getTime()) / 1000);
      }

      // Open session থাকলে update করো
      if (state.sessionId) {
        try {
          await this.prisma.attendanceSession.update({
            where: { id: state.sessionId },
            data: {
              checkOutTime: now,
              hoursWorked: secondsToHours(finalZoneSeconds),
              zoneSeconds: finalZoneSeconds,
              outsideSeconds: finalOutsideSeconds,
              outLat: state.lat,
              outLng: state.lng,
            },
          });

          // Attendance total hours update
          const session = await this.prisma.attendanceSession.findUnique({
            where: { id: state.sessionId },
            select: { attendanceId: true },
          });

          if (session) {
            await this.prisma.attendance.update({
              where: { id: session.attendanceId },
              data: { totalHours: secondsToHours(finalZoneSeconds) },
            });
          }
        } catch (e) {
          console.error('Session update on disconnect failed:', e);
        }
      }

      // Admin কে জানাও worker offline হয়েছে
      this.server.to(`project_${projectId}`).emit('worker_offline', {
        workerId: user.id,
        workerName: user.fullName,
        totalZoneHours: secondsToHours(finalZoneSeconds),
        totalOutsideHours: secondsToHours(finalOutsideSeconds),
        disconnectedAt: now,
      });

      this.workerStates.delete(user.id);
    }

    this.connectedUsers.delete(client.id);
    this.userSockets.delete(user.id);
    console.log(`❌ Disconnected: ${user.fullName} - ${client.id}`);
  }

  // ─── JOIN PROJECT (Admin এর জন্য) ─────────────────────────────────────────
  @SubscribeMessage('join_project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    if (user.role === 'super_admin') {
      const project = await this.prisma.project.findUnique({ where: { id: data.projectId } });
      if (!project) { client.emit('error', { message: 'Project not found' }); return; }
      client.join(`project_${data.projectId}`);
    } else {
      const project = await this.prisma.project.findFirst({
        where: {
          id: data.projectId,
          OR: [
            { company: { ownerId: user.id } },
            { teamMembers: { some: { userId: user.id } } },
          ],
        },
      });
      if (!project) { client.emit('error', { message: 'No access' }); return; }
      client.join(`project_${data.projectId}`);
    }

    client.emit('joined_project', { projectId: data.projectId });

    // Admin join করলে সব active workers এর current location পাঠাও
    const activeWorkers: any[] = [];
    this.workerStates.forEach((state) => {
      if (state.projectId === data.projectId && state.lat !== 0) {
        activeWorkers.push({
          workerId: state.userId,
          workerName: state.fullName,
          avatarUrl: state.avatarUrl,
          lat: state.lat,
          lng: state.lng,
          isInsideZone: state.isInsideZone,
          zoneName: state.zoneName,
          totalZoneHours: secondsToHours(state.totalZoneSeconds),
          timestamp: state.timestamp,
        });
      }
    });

    client.emit('active_workers', {
      projectId: data.projectId,
      workers: activeWorkers,
      count: activeWorkers.length,
    });

    console.log(`👁️ ${user.fullName} watching project: ${data.projectId} | Active workers: ${activeWorkers.length}`);
  }

  // ─── LEAVE PROJECT ────────────────────────────────────────────────────────
  @SubscribeMessage('leave_project')
  handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    client.leave(`project_${data.projectId}`);
    client.emit('left_project', { projectId: data.projectId });
  }

  // ─── LOCATION UPDATE (Core — Google Maps style) ───────────────────────────
  @SubscribeMessage('location_update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; projectId?: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const { lat, lng } = data;

    // projectId — worker এর state থেকে নাও, data থেকে না
    const projectId = client.data.projectId ?? data.projectId;
    if (!projectId) {
      client.emit('error', { message: 'No active project found' });
      return;
    }

    const now = new Date();
    let state = this.workerStates.get(user.id);

    // State না থাকলে নতুন বানাও
    if (!state) {
      state = {
        userId: user.id,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        projectId,
        lat,
        lng,
        isInsideZone: false,
        zoneName: null,
        timestamp: now,
        zoneEnteredAt: null,
        totalZoneSeconds: 0,
        totalOutsideSeconds: 0,
        outsideStartedAt: now,
        hasActiveViolation: false,
        sessionId: null,
      };
      this.workerStates.set(user.id, state);
    }

    // Active geofences load করো
    const geofences = await this.prisma.geofence.findMany({
      where: { projectId, isActive: true },
    });

    // Zone check
    let isInsideAny = false;
    let currentZone: any = null;
    let nearestGeofence: any = null;

    for (const geo of geofences) {
      const coords = parsePolygonCoords(geo.polygonCoords);
      const inside = coords.length >= 3 ? pointInPolygon(lat, lng, coords) : false;

      if (inside) {
        isInsideAny = true;
        currentZone = geo;
        break;
      }
      if (!nearestGeofence) nearestGeofence = geo;
    }

    const effectiveZone = currentZone ?? nearestGeofence;
    const wasInsideZone = state.isInsideZone;

    // ─── Zone Enter detect ────────────────────────────────────────────────
    if (isInsideAny && !wasInsideZone) {
      // বাইরে থাকার সময় count করো
      if (state.outsideStartedAt) {
        state.totalOutsideSeconds += Math.floor(
          (now.getTime() - state.outsideStartedAt.getTime()) / 1000
        );
        state.outsideStartedAt = null;
      }

      state.zoneEnteredAt = now;
      state.isInsideZone = true;
      state.zoneName = currentZone.zoneName;
      state.hasActiveViolation = false;

      // LocationLog — enter event
      await this.prisma.locationLog.create({
        data: {
          userId: user.id,
          geofenceId: currentZone.id,
          lat, lng,
          eventType: 'enter',
          isInsideZone: true,
        },
      });

      // Admin কে জানাও zone এ ফিরেছে
      this.server.to(`project_${projectId}`).emit('zone_restored', {
        workerId: user.id,
        workerName: user.fullName,
        zoneName: currentZone.zoneName,
        restoredAt: now,
      });

      console.log(`✅ ${user.fullName} ENTERED zone: ${currentZone.zoneName}`);
    }

    // ─── Zone Exit detect ─────────────────────────────────────────────────
    else if (!isInsideAny && wasInsideZone) {
      // Zone এ থাকার সময় count করো
      if (state.zoneEnteredAt) {
        state.totalZoneSeconds += Math.floor(
          (now.getTime() - state.zoneEnteredAt.getTime()) / 1000
        );
        state.zoneEnteredAt = null;
      }

      state.outsideStartedAt = now;
      state.isInsideZone = false;
      state.zoneName = null;

      // LocationLog — exit event
      await this.prisma.locationLog.create({
        data: {
          userId: user.id,
          geofenceId: effectiveZone?.id ?? null,
          lat, lng,
          eventType: 'exit',
          isInsideZone: false,
        },
      });

      // Violation create করো — একবারই
      if (!state.hasActiveViolation && effectiveZone) {
        const coords = parsePolygonCoords(effectiveZone.polygonCoords);
        const center = coords.length > 0 ? polygonCenter(coords) : { lat, lng };
        const distanceM = Math.round(haversineDistance(lat, lng, center.lat, center.lng));

        const violation = await this.prisma.geofenceViolation.create({
          data: {
            geofenceId: effectiveZone.id,
            userId: user.id,
            distanceM,
            description: `Worker is ${distanceM}m outside the zone: ${effectiveZone.zoneName}`,
            isResolved: false,
          },
        });

        state.hasActiveViolation = true;

        this.server.to(`project_${projectId}`).emit('zone_violation', {
          violation: {
            id: violation.id,
            worker: { id: user.id, fullName: user.fullName },
            geofenceName: effectiveZone.zoneName,
            distanceM,
            occurredAt: violation.occurredAt,
          },
        });

        console.log(`⚠️ ${user.fullName} EXITED zone: ${effectiveZone.zoneName} (${distanceM}m away)`);
      }
    }

    // ─── Zone এর ভেতরে থাকলে update event ───────────────────────────────
    else if (isInsideAny) {
      await this.prisma.locationLog.create({
        data: {
          userId: user.id,
          geofenceId: currentZone.id,
          lat, lng,
          eventType: 'update',
          isInsideZone: true,
        },
      });
    }

    // ─── বাইরে থাকলে — update event only (violation নতুন করে না) ────────
    else {
      await this.prisma.locationLog.create({
        data: {
          userId: user.id,
          geofenceId: effectiveZone?.id ?? null,
          lat, lng,
          eventType: 'update',
          isInsideZone: false,
        },
      });
    }

    // State update করো
    state.lat = lat;
    state.lng = lng;
    state.timestamp = now;
    if (isInsideAny) state.zoneName = currentZone.zoneName;

    // Current zone seconds calculate (real-time)
    let currentZoneSeconds = state.totalZoneSeconds;
    if (state.isInsideZone && state.zoneEnteredAt) {
      currentZoneSeconds += Math.floor((now.getTime() - state.zoneEnteredAt.getTime()) / 1000);
    }

    // ─── Broadcast to all in project room ────────────────────────────────
    this.server.to(`project_${projectId}`).emit('worker_location', {
      workerId: user.id,
      workerName: user.fullName,
      avatarUrl: user.avatarUrl,
      lat,
      lng,
      isInsideZone: isInsideAny,
      zoneName: isInsideAny ? currentZone.zoneName : null,
      totalZoneHours: secondsToHours(currentZoneSeconds),
      timestamp: now,
    });

    // Worker কে confirm করো
    client.emit('location_received', {
      isInsideZone: isInsideAny,
      zoneName: isInsideAny ? currentZone.zoneName : null,
      totalZoneHours: secondsToHours(currentZoneSeconds),
      message: isInsideAny ? '✅ You are inside the zone' : '⚠️ You are outside the zone',
    });
  }

  // ─── CHECK IN ─────────────────────────────────────────────────────────────
  @SubscribeMessage('check_in')
  async handleCheckIn(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; projectId?: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const { lat, lng } = data;
    const projectId = client.data.projectId ?? data.projectId;
    if (!projectId) { client.emit('error', { message: 'No active project' }); return; }

    const geofences = await this.prisma.geofence.findMany({
      where: { projectId, isActive: true },
    });

    let checkedInZone: any = null;
    let isInsideAny = false;

    for (const geo of geofences) {
      const coords = parsePolygonCoords(geo.polygonCoords);
      const inside = coords.length >= 3 ? pointInPolygon(lat, lng, coords) : false;
      if (inside) {
        isInsideAny = true;
        checkedInZone = geo;
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

    const session = await this.prisma.attendanceSession.create({
      data: {
        attendanceId: attendance.id,
        checkInTime: new Date(),
        inLat: lat,
        inLng: lng,
        zoneSeconds: 0,
        outsideSeconds: 0,
      },
    });

    // State এ sessionId save করো এবং time tracking শুরু
    const state = this.workerStates.get(user.id);
    if (state) {
      state.sessionId = session.id;
      state.totalZoneSeconds = 0;
      state.totalOutsideSeconds = 0;

      if (isInsideAny) {
        state.isInsideZone = true;
        state.zoneEnteredAt = new Date();
        state.outsideStartedAt = null;
        state.zoneName = checkedInZone.zoneName;
      } else {
        state.isInsideZone = false;
        state.zoneEnteredAt = null;
        state.outsideStartedAt = new Date();
      }
    }

    const payload = {
      worker: { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl },
      zoneName: checkedInZone?.zoneName ?? 'Unknown Zone',
      isInsideZone: isInsideAny,
      checkInTime: new Date(),
    };

    this.server.to(`project_${projectId}`).emit('worker_checked_in', payload);
    client.emit('check_in_confirmed', {
      message: checkedInZone
        ? `✅ Checked in to ${checkedInZone.zoneName}`
        : '⚠️ Checked in but outside zone boundaries',
      sessionId: session.id,
      ...payload,
    });
  }

  // ─── CHECK OUT ────────────────────────────────────────────────────────────
  @SubscribeMessage('check_out')
  async handleCheckOut(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; projectId?: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    const { lat, lng } = data;
    const projectId = client.data.projectId ?? data.projectId;
    if (!projectId) { client.emit('error', { message: 'No active project' }); return; }

    const now = new Date();
    const state = this.workerStates.get(user.id);

    let finalZoneSeconds = state?.totalZoneSeconds ?? 0;
    let finalOutsideSeconds = state?.totalOutsideSeconds ?? 0;

    if (state) {
      // Zone এ থাকলে শেষ সময় add করো
      if (state.isInsideZone && state.zoneEnteredAt) {
        finalZoneSeconds += Math.floor((now.getTime() - state.zoneEnteredAt.getTime()) / 1000);
      }
      // বাইরে থাকলে শেষ সময় add করো
      else if (!state.isInsideZone && state.outsideStartedAt) {
        finalOutsideSeconds += Math.floor((now.getTime() - state.outsideStartedAt.getTime()) / 1000);
      }
    }

    const hoursWorked = secondsToHours(finalZoneSeconds);

    // Session update করো
    const sessionId = state?.sessionId;
    if (sessionId) {
      await this.prisma.attendanceSession.update({
        where: { id: sessionId },
        data: {
          checkOutTime: now,
          hoursWorked,
          zoneSeconds: finalZoneSeconds,
          outsideSeconds: finalOutsideSeconds,
          outLat: lat,
          outLng: lng,
        },
      });

      const session = await this.prisma.attendanceSession.findUnique({
        where: { id: sessionId },
        select: { attendanceId: true },
      });

      if (session) {
        await this.prisma.attendance.update({
          where: { id: session.attendanceId },
          data: { totalHours: hoursWorked },
        });
      }
    }

    // State reset করো
    if (state) {
      state.sessionId = null;
      state.totalZoneSeconds = 0;
      state.totalOutsideSeconds = 0;
      state.zoneEnteredAt = null;
      state.outsideStartedAt = null;
    }

    const payload = {
      worker: { id: user.id, fullName: user.fullName },
      checkOutTime: now,
      hoursWorked,
      zoneHours: secondsToHours(finalZoneSeconds),
      outsideHours: secondsToHours(finalOutsideSeconds),
    };

    this.server.to(`project_${projectId}`).emit('worker_checked_out', payload);
    client.emit('check_out_confirmed', {
      message: '✅ Checked out successfully',
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

    const activeWorkers: any[] = [];
    this.workerStates.forEach((state) => {
      if (state.projectId === data.projectId && state.lat !== 0) {
        let currentZoneSeconds = state.totalZoneSeconds;
        if (state.isInsideZone && state.zoneEnteredAt) {
          currentZoneSeconds += Math.floor(
            (new Date().getTime() - state.zoneEnteredAt.getTime()) / 1000
          );
        }
        activeWorkers.push({
          workerId: state.userId,
          workerName: state.fullName,
          avatarUrl: state.avatarUrl,
          lat: state.lat,
          lng: state.lng,
          isInsideZone: state.isInsideZone,
          zoneName: state.zoneName,
          totalZoneHours: secondsToHours(currentZoneSeconds),
          lastSeen: state.timestamp,
        });
      }
    });

    const outsideZoneCount = await this.prisma.geofenceViolation.count({
      where: { geofence: { projectId: data.projectId }, isResolved: false },
    });

    client.emit('live_workers', {
      projectId: data.projectId,
      workersOnSite: activeWorkers.length,
      outsideZone: outsideZoneCount,
      workers: activeWorkers,
    });
  }

  // ─── PROJECT ACCESS VERIFY ────────────────────────────────────────────────
  private async verifyProjectAccess(projectId: string, userId: string, userRole: string) {
    if (userRole === 'super_admin') return;
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
    if (!project) throw new Error('Project not found or no access');
  }

  // ─── GET GEOFENCES (REST helper) ──────────────────────────────────────────
  async getGeofences(projectId: string, userId: string, userRole: string) {
    await this.verifyProjectAccess(projectId, userId, userRole);

    const geofences = await this.prisma.geofence.findMany({ where: { projectId } });

    return geofences.map((geo) => {
      const coords = parsePolygonCoords(geo.polygonCoords);
      const center = coords.length > 0 ? polygonCenter(coords) : null;
      return { ...geo, center };
    });
  }
}