import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { S3Service } from '../../s3/s3.service';
import { CreateCompanyDto, UpdateCompanyDto, CreateContactDto, UpdateContactDto, PaginationQueryDto } from './dto/company.dto';


@Injectable()
export class CompanyService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notificationsService: NotificationsService,
    private s3Service: S3Service,
  ) { }

  private async getAccessibleCompanyIds(userId: string, userRole: string) {
    if (userRole === 'admin') {
      const ownedCompanies = await this.prisma.company.findMany({
        where: { ownerId: userId, isActive: true },
        select: { id: true },
      });
      return ownedCompanies.map((company) => company.id);
    }

    if (userRole === 'manager') {
      const memberships = await this.prisma.companyMember.findMany({
        where: { userId },
        select: { companyId: true },
      });

      return [...new Set(memberships.map((membership) => membership.companyId))];
    }

    return [];
  }

  private async verifyOwner(companyId: string, adminId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.ownerId !== adminId) throw new ForbiddenException('You do not own this company');
    return company;
  }

  private async verifyCompanyAccess(companyId: string, userId: string, userRole: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, ownerId: true, isActive: true },
    });

    if (!company || !company.isActive) {
      throw new NotFoundException('Company not found');
    }

    if (userRole === 'admin' && company.ownerId === userId) {
      return company;
    }

    if (userRole === 'manager') {
      const membership = await this.prisma.companyMember.findUnique({
        where: {
          companyId_userId: {
            companyId,
            userId,
          },
        },
      });

      if (membership) return company;
    }

    throw new ForbiddenException('Access denied');
  }

  // ─── PLAN LIMIT CHECK ─────────────────────────────────────────────────────
  private async checkCompanyLimit(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin?.tenantId) {
      throw new ForbiddenException('Please purchase a subscription before creating a company.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: admin.tenantId },
      include: { plan: { select: { maxCompanies: true } } },
    });

    if (!tenant) {
      throw new ForbiddenException('Your subscription could not be verified.');
    }

    if (tenant.status === 'suspended')
      throw new ForbiddenException('Your account is suspended. Please contact support.');
    if (tenant.status === 'cancelled')
      throw new ForbiddenException('Your subscription has been cancelled.');

    const max = tenant.plan.maxCompanies;
    if (max === null || max === undefined) return;

    const currentCount = await this.prisma.company.count({
      where: { ownerId: adminId, isActive: true },
    });

    if (currentCount >= max) {
      throw new ForbiddenException(
        `Company limit reached (${currentCount}/${max}). Please upgrade your plan.`,
      );
    }
  }

  async getMyCompanies(adminId: string, query: PaginationQueryDto, userRole: string = 'admin') {
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const accessibleCompanyIds = await this.getAccessibleCompanyIds(adminId, userRole);
    const where: any = {
      isActive: true,
      ...(userRole === 'manager'
        ? { id: { in: accessibleCompanyIds } }
        : { ownerId: adminId }),
    };
    if (search && search.trim()) {
      const s = search.trim();
      where.AND = [
        {
          OR: [
            { name: { contains: s, mode: 'insensitive' } },
            { industry: { contains: s, mode: 'insensitive' } },
            { email: { contains: s, mode: 'insensitive' } },
            { phone: { contains: s, mode: 'insensitive' } },
            { website: { contains: s, mode: 'insensitive' } },
            { address: { contains: s, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [companies, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          industry: true,
          revenue: true,
          projectLevel: true,
          address: true,
          website: true,
          phone: true,
          email: true,
          logoUrl: true,
          isActive: true,
          createdAt: true,
          _count: { select: { projects: true, members: true } },
        },
      }),
      this.prisma.company.count({ where }),
    ]);


    const normalized = companies.map((c) => ({
      ...c,
      logoUrl: c.logoUrl ?? null,
    }));

    return {
      data: normalized,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getCompanyProfile(companyId: string, adminId: string, userRole: string = 'admin') {
    await this.verifyCompanyAccess(companyId, adminId, userRole);
    const company: any = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        _count: { select: { projects: true, members: true } },
        certifications: true,
        members: {
          orderBy: { joinedAt: 'asc' },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return {
      ...company,
      contacts: company.members.map((member) => ({
        id: member.user.id,
        fullName: member.user.fullName,
        role: member.role,
        email: member.user.email,
        phone: member.user.phone,
        avatarUrl: member.user.avatarUrl,
        isPrimary: member.user.id === company.ownerId,
      })),
    };
  }

  // ─── CREATE COMPANY ───────────────────────────────────────────────────────
  async createCompany(dto: CreateCompanyDto, adminId: string, logoUrl?: string) {
    await this.checkCompanyLimit(adminId);

    const company = await this.prisma.company.create({
      data: {
        ownerId: adminId,
        name: dto.name,
        industry: dto.industry,
        description: dto.description,
        phone: dto.phone,
        email: dto.email,
        website: dto.website,
        address: dto.address,
        revenue: dto.revenue,
        projectLevel: dto.projectLevel,
        logoUrl,
      },
    });

    await this.notificationsService.send({
      targetRole: 'super_admin',
      title: 'New company created',
      body: `${dto.name} company has been created`,
      type: 'general',
      refType: 'company',
      refId: company.id,
    });

    return company;
  }

  async updateCompany(companyId: string, dto: UpdateCompanyDto, adminId: string, logoUrl?: string, userRole: string = 'admin') {
    await this.verifyCompanyAccess(companyId, adminId, userRole);

    const { logoUrl: _, ...restDto } = dto;

    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...restDto,
        ...(logoUrl && { logoUrl }),
      },
    });
  }

  async deleteCompany(companyId: string, adminId: string, userRole: string = 'admin') {
    await this.verifyCompanyAccess(companyId, adminId, userRole);
    await this.prisma.company.update({ where: { id: companyId }, data: { isActive: false } });
    return { message: 'Company deactivated successfully' };
  }

  async hardDeleteCompany(companyId: string, adminId: string, userRole: string = 'admin') {
    await this.verifyCompanyAccess(companyId, adminId, userRole);
    await this.prisma.company.delete({ where: { id: companyId } });
    return { message: 'Company permanently deleted successfully' };
  }

  async getAssignedProjects(companyId: string, adminId: string, userRole: string = 'admin') {
    await this.verifyCompanyAccess(companyId, adminId, userRole);
    return this.prisma.project.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, type: true, status: true, priority: true, isWholeHouse: true, houseSections: true, progress: true,
        startDate: true, endDate: true, budget: true, location: true,
        _count: { select: { teamMembers: true, tasks: true } },
        teamMembers: {
          take: 5,
          include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
        },
      },
    });
  }

  async getContacts(companyId: string, adminId: string, query: PaginationQueryDto, userRole: string = 'admin') {
    await this.verifyCompanyAccess(companyId, adminId, userRole);
    const { page = 1, limit = 20 } = query;

    const members = await this.prisma.projectMember.findMany({
      where: { project: { companyId }, role: { in: ['manager', 'worker'] } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: {
        project: { select: { id: true, name: true } },
        user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true } },
      },
    });

    const grouped = new Map<string, any>();
    for (const member of members) {
      const existing = grouped.get(member.user.id);
      const proj = { id: member.project.id, name: member.project.name, role: member.role ?? 'worker', joinedAt: member.createdAt };
      if (existing) {
        existing.projects.push(proj);
      } else {
        grouped.set(member.user.id, {
          userId: member.user.id,
          fullName: member.user.fullName,
          email: member.user.email,
          phone: member.user.phone ?? null,
          avatarUrl: member.user.avatarUrl ?? null,
          systemRole: member.user.role ?? '',
          projects: [proj],
        });
      }
    }

    const allGrouped = Array.from(grouped.values());
    const total = allGrouped.length;
    const skip = (page - 1) * limit;
    return {
      data: allGrouped.slice(skip, skip + limit),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getDocuments(companyId: string, adminId: string, userRole: string = 'admin') {
    await this.verifyCompanyAccess(companyId, adminId, userRole);
    return this.prisma.document.findMany({
      where: { companyId },
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true, fileName: true, fileUrl: true, fileType: true, fileSizeMb: true, uploadedAt: true,
        company: { select: { id: true, name: true } },
        uploadedByUser: { select: { id: true, fullName: true } },
      },
    });
  }

  async uploadDocument(companyId: string, adminId: string, file: Express.Multer.File, userRole: string = 'admin', fileUrl?: string) {
    await this.verifyCompanyAccess(companyId, adminId, userRole);
    if (!fileUrl) {
      throw new BadRequestException('S3 upload failed');
    }
    const fileSizeMb = file.size / (1024 * 1024);
    return this.prisma.document.create({
      data: {
        companyId,
        uploadedBy: adminId,
        fileName: file.originalname,
        fileUrl,
        fileType: file.mimetype,
        fileSizeMb: Math.round(fileSizeMb * 100) / 100,
      },
    });
  }

  async deleteDocument(companyId: string, documentId: string, adminId: string, userRole: string = 'admin') {
    await this.verifyCompanyAccess(companyId, adminId, userRole);
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { companyId: true, fileUrl: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.companyId !== companyId) throw new ForbiddenException('Document does not belong to this company');

    if (doc.fileUrl) {
      await this.s3Service.deleteFile(doc.fileUrl);
    }

    await this.prisma.document.delete({ where: { id: documentId } });
    return { message: 'Document deleted successfully' };
  }
}
