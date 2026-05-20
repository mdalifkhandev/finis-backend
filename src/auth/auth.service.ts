import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { LoginDto } from './dto/login.dto';
import { InviteDto } from './dto/invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserRole } from '../generated/prisma/client';

const otpStore = new Map<string, { email: string; otp: string; expiresAt: Date }>();
const resetTokenStore = new Map<string, { identifier: string; expiresAt: Date }>();

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mailService: MailService,
  ) { }

  // ── LOGIN ──────────────────────────────────
  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    let user:
      | {
          id: string;
          email: string;
          phone: string | null;
          fullName: string;
          role: UserRole;
          status: string;
          tenantId: string | null;
          avatarUrl: string | null;
          passwordHash: string | null;
        }
      | null = null;
    try {
      if (emailPattern.test(identifier)) {
        user = await this.prisma.user.findUnique({
          where: { email: identifier },
          select: {
            id: true,
            email: true,
            phone: true,
            fullName: true,
            role: true,
            status: true,
            tenantId: true,
            avatarUrl: true,
            passwordHash: true,
          },
        });
      } else {
        user = await this.prisma.user.findFirst({
          where: { phone: identifier },
          select: {
            id: true,
            email: true,
            phone: true,
            fullName: true,
            role: true,
            status: true,
            tenantId: true,
            avatarUrl: true,
            passwordHash: true,
          },
        });
      }
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.status === 'suspended') throw new UnauthorizedException('Account suspended');
    if (user.status === 'inactive') throw new UnauthorizedException('Account inactive');
    if (user.status === 'pending') throw new UnauthorizedException('Account pending activation');

    // FIX: passwordHash could be null in DB, guard it
    if (!user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = this.generateToken(
      user.id,
      user.email,
      user.role,
      dto.rememberMe ? '30d' : undefined,
    );

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        avatarUrl: user.avatarUrl,
        tenantId: user.tenantId,
      },
    };
  }

  async logout(userId: string) {
    if (!userId) {
      throw new BadRequestException('User id is required');
    }

    return {
      message: 'Logged out successfully',
    };
  }

  // ── SEED SUPER ADMIN ──────────────────────
  async seedSuperAdmin() {
    const existing = await this.prisma.user.findFirst({
      where: { role: UserRole.super_admin },
    });

    if (existing) throw new ConflictException('Super admin already exists');

    const hash = await bcrypt.hash('Admin@12345', 10);

    const admin = await this.prisma.user.create({
      data: {
        email: 'superadmin@finis.com',
        fullName: 'Super Admin',
        passwordHash: hash,
        role: UserRole.super_admin,
        status: 'active',
      },
    });

    return {
      message: 'Super admin created',
      email: admin.email,
      password: 'Admin@12345',
    };
  }

  // ── INVITE ────────────────────────────────
  async inviteUser(senderId: string, dto: InviteDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone required');
    }

    // FIX: role must be defined
    if (!dto.role) {
      throw new BadRequestException('Role is required');
    }

    if (dto.email) {
      const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (exists) throw new ConflictException('User with this email already exists');
    }

    const pending = await this.prisma.invitation.findFirst({
      where: {
        OR: [
          ...(dto.email ? [{ email: dto.email }] : []),
          ...(dto.phone ? [{ phone: dto.phone }] : []),
        ],
        status: 'pending',
      },
    });
    if (pending) throw new ConflictException('Pending invitation already exists');

      // Auto-register user on invite with a random 6-digit password
      const plainPassword = Math.floor(100000 + Math.random() * 900000).toString();
      const passwordHash = await bcrypt.hash(plainPassword, 10);

      const userEmail = dto.email ?? `phone_${dto.phone}@finis.internal`;

      const user = await this.prisma.user.create({
        data: {
          email: userEmail,
          phone: dto.phone ?? null,
          fullName: dto.email ? dto.email.split('@')[0] : 'Invited User',
          passwordHash,
          role: dto.role,
          status: 'active',
        },
      });

      // If role is worker and sender is manager, link them
      if (dto.role === UserRole.worker) {
        const sender = await this.prisma.user.findUnique({ where: { id: senderId }, select: { role: true } });
        if (sender?.role === UserRole.manager) {
          await this.prisma.workerManagerMap.create({ data: { managerId: senderId, workerId: user.id } });
        }
      }

      // Create invitation record but mark as accepted
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const invitation = await this.prisma.invitation.create({
        data: {
          senderId,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          role: dto.role,
          token,
          expiresAt,
          status: 'accepted',
          receiverId: user.id,
        },
      });

      // Send credentials by email when email provided
      if (dto.email) {
        await this.mailService.sendCredentialsEmail(dto.email, plainPassword, dto.role);
      }

      // Also log credentials to console as requested
      console.log('Invited user credentials ->', { email: user.email, password: plainPassword });

      return { message: 'User invited and registered', userId: user.id, invitationId: invitation.id };
  }

  // ── ACCEPT INVITE ─────────────────────────
  async acceptInvite(dto: AcceptInviteDto) {
    // FIX: validate required fields
    if (!dto.token) throw new BadRequestException('Token is required');
    if (!dto.fullName) throw new BadRequestException('Full name is required');
    if (!dto.password) throw new BadRequestException('Password is required');

    const invitation = await this.prisma.invitation.findUnique({
      where: { token: dto.token },
    });

    if (!invitation) throw new NotFoundException('Invalid invitation token');
    if (invitation.status !== 'pending') throw new BadRequestException('Invitation already used or cancelled');
    if (new Date() > invitation.expiresAt) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Invitation expired');
    }

    // FIX: await hash first, then use it
    const hash = await bcrypt.hash(dto.password, 10);

    // FIX: email must be string (not null/undefined) for User model
    // If phone-only invite, email won't be set — handle accordingly
    const userEmail = invitation.email ?? `phone_${invitation.phone}@finis.internal`;

    const user = await this.prisma.user.create({
      data: {
        email: userEmail,
        phone: invitation.phone ?? null,
        fullName: dto.fullName,
        passwordHash: hash,
        role: invitation.role,
        status: 'active',
      },
    });

    if (invitation.role === UserRole.worker) {
      const sender = await this.prisma.user.findUnique({
        where: { id: invitation.senderId },
        select: { role: true },
      });

      if (sender?.role === UserRole.manager) {
        await this.prisma.workerManagerMap.create({
          data: {
            managerId: invitation.senderId,
            workerId: user.id,
          },
        });
      }
    }

    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', receiverId: user.id },
    });

    const token = this.generateToken(user.id, user.email, user.role);

    return {
      message: 'Account created successfully',
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }



  // ── FORGOT PASSWORD ───────────────────────
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });

    if (!user) throw new NotFoundException('User not found');

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const forgotToken = uuidv4(); // ← token generate
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // key = forgotToken, value = { email, otp, expiresAt }
    otpStore.set(forgotToken, { email: dto.email, otp, expiresAt });

    await this.mailService.sendOtpEmail(dto.email, otp);

    return {
      message: 'OTP sent to email',
      forgotToken,
      ...(this.config.get('NODE_ENV') !== 'production' && { otp }),
    };
  }

  // ── VERIFY OTP ────────────────────────────
  async verifyOtp(dto: VerifyOtpDto) {
    const stored = otpStore.get(dto.forgotToken);

    if (!stored) throw new BadRequestException('Invalid or expired token');
    if (new Date() > stored.expiresAt) {
      otpStore.delete(dto.forgotToken);
      throw new BadRequestException('OTP expired');
    }
    if (stored.otp !== dto.otp) throw new BadRequestException('Invalid OTP');

    otpStore.delete(dto.forgotToken);

    const resetToken = uuidv4();
    resetTokenStore.set(resetToken, {
      identifier: stored.email,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    return { message: 'OTP verified', resetToken };
  }
  // ── RESET PASSWORD ────────────────────────
  async resetPassword(dto: ResetPasswordDto) {
    // FIX: validate required fields
    if (!dto.resetToken) throw new BadRequestException('Reset token is required');
    if (!dto.newPassword) throw new BadRequestException('New password is required');

    const stored = resetTokenStore.get(dto.resetToken);

    if (!stored) throw new BadRequestException('Invalid or expired reset token');
    if (new Date() > stored.expiresAt) {
      resetTokenStore.delete(dto.resetToken);
      throw new BadRequestException('Reset token expired');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: stored.identifier }, { phone: stored.identifier }],
      },
    });

    if (!user) throw new NotFoundException('User not found');

    // FIX: await hash, then pass as string
    const hash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });

    resetTokenStore.delete(dto.resetToken);

    return { message: 'Password updated successfully' };
  }

  // ── GET INVITATIONS ───────────────────────
  async getInvitations(
    senderId: string,
    userRole: string,
    filterRole?: string,
    filterStatus?: string,
    search?: string,
  ) {
    const validRoles = ['admin', 'manager', 'worker'];
    const validStatuses = ['pending', 'accepted', 'expired', 'cancelled'];

    const where: any = (userRole === UserRole.super_admin || userRole === UserRole.admin) ? {} : { senderId };

    // Filter by role if provided
    if (filterRole && validRoles.includes(filterRole)) {
      where.role = filterRole;

      // If search is provided with role filter, search within role
      if (search) {
        const searchLower = search.toLowerCase();
        where.OR = [
          { email: { contains: searchLower, mode: 'insensitive' } },
          { phone: { contains: searchLower, mode: 'insensitive' } },
        ];
      }
    }
    // Filter by status if provided
    else if (filterStatus && validStatuses.includes(filterStatus)) {
      where.status = filterStatus;

      // If search is provided with status filter, search within status
      if (search) {
        const searchLower = search.toLowerCase();
        where.OR = [
          { email: { contains: searchLower, mode: 'insensitive' } },
          { phone: { contains: searchLower, mode: 'insensitive' } },
        ];
      }
    }
    // If no filters, search across all
    else if (search) {
      const searchLower = search.toLowerCase();
      const matchingRoles = validRoles.filter(r => r.includes(searchLower));
      const matchingStatuses = validStatuses.filter(s => s.includes(searchLower));

      where.OR = [
        ...(matchingRoles.length > 0 ? [{ role: { in: matchingRoles } }] : []),
        ...(matchingStatuses.length > 0 ? [{ status: { in: matchingStatuses } }] : []),
        { email: { contains: searchLower, mode: 'insensitive' } },
        { phone: { contains: searchLower, mode: 'insensitive' } },
      ];
    }

    if (filterRole === 'worker') {
      const workerMembers = await this.prisma.projectMember.findMany({
        where: {
          role: 'worker',
          managerId: { not: null },
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
              avatarUrl: true,
              status: true,
              phone: true,
            },
          },
        },
      });

      // managerId গুলো collect করো
      const managerIds = [...new Set(workerMembers.map((m) => m.managerId).filter(Boolean))] as string[];

      // manager details এক সাথে আনো
      const managers = await this.prisma.user.findMany({
        where: { id: { in: managerIds } },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          avatarUrl: true,
        },
      });

      const managerMap = Object.fromEntries(managers.map((m) => [m.id, m]));

      const workers = workerMembers.map((member) => ({
        id: member.user.id,
        fullName: member.user.fullName,
        email: member.user.email,
        role: member.user.role,
        avatarUrl: member.user.avatarUrl,
        status: member.user.status,
        phone: member.user.phone,
        managerId: member.managerId,
        manager: member.managerId ? managerMap[member.managerId] ?? null : null,
      }));

      return { workers };
    }

    const invitations = await this.prisma.invitation.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map((invitation) => ({
      ...invitation,
      manager: invitation.role === UserRole.worker ? invitation.sender : null,
    }));
  }

  // ── RESEND INVITATION ─────────────────────
  async resendInvitation(invitationId: string, senderId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, senderId },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== 'pending') throw new BadRequestException('Cannot resend non-pending invitation');

    const newToken = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { token: newToken, expiresAt },
    });

    if (invitation.email) {
      await this.mailService.sendInviteEmail(invitation.email, newToken, invitation.role);
    }

    return { message: 'Invitation resent' };
  }

  // ── CANCEL INVITATION ─────────────────────
  async cancelInvitation(invitationId: string, senderId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, senderId },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'cancelled' },
    });

    return { message: 'Invitation cancelled' };
  }

  // ── ME ────────────────────────────────────
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        role: true,
        status: true,
        avatarUrl: true,
        tenantId: true,
        department: true,
        joinDate: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ── HELPER ────────────────────────────────
  private generateToken(userId: string, email: string, role: string, expiresIn?: string) {
    const signOptions: JwtSignOptions = expiresIn ? { expiresIn: expiresIn as JwtSignOptions['expiresIn'] } : {};

    return this.jwtService.sign({ sub: userId, email, role }, signOptions);
  }
}