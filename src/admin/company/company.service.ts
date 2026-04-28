import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto, CreateContactDto, UpdateContactDto, PaginationQueryDto } from './dto/company.dto';
import { File as MulterFile } from 'multer';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) { }

  // ─── HELPER: verify admin owns this company ──────────────────────────────
  private async verifyOwner(companyId: string, adminId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');
    if (company.ownerId !== adminId)
      throw new ForbiddenException('You do not own this company');
    return company;
  }

  // ─── GET ALL MY COMPANIES ─────────────────────────────────────────────────
  async getMyCompanies(adminId: string, query: PaginationQueryDto) {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const [companies, total] = await Promise.all([
      this.prisma.company.findMany({
        where: { ownerId: adminId, isActive: true },
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
      this.prisma.company.count({
        where: { ownerId: adminId, isActive: true },
      }),
    ]);

    return {
      data: companies,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── GET COMPANY PROFILE ──────────────────────────────────────────────────
  async getCompanyProfile(companyId: string, adminId: string) {
    await this.verifyOwner(companyId, adminId);

    return this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        _count: {
          select: { projects: true, members: true },
        },
        certifications: true,
      },
    });
  }

  // ─── CREATE COMPANY ───────────────────────────────────────────────────────
  async createCompany(dto: CreateCompanyDto, adminId: string, logoUrl?: string) {
    return this.prisma.company.create({
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
  }

  // ─── UPDATE COMPANY ───────────────────────────────────────────────────────
  async updateCompany(
    companyId: string,
    dto: UpdateCompanyDto,
    adminId: string,
    logoUrl?: string,
  ) {
    await this.verifyOwner(companyId, adminId);

    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...dto,
        ...(logoUrl && { logoUrl }),
      },
    });
  }

  // ─── DELETE COMPANY ───────────────────────────────────────────────────────
  async deleteCompany(companyId: string, adminId: string) {
    await this.verifyOwner(companyId, adminId);

    await this.prisma.company.update({
      where: { id: companyId },
      data: { isActive: false },
    });

    return { message: 'Company deactivated successfully' };
  }

  // ─── ASSIGN PROJECT TO COMPANY ────────────────────────────────────────────
  async getAssignedProjects(companyId: string, adminId: string) {
    await this.verifyOwner(companyId, adminId);

    return this.prisma.project.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        progress: true,
        startDate: true,
        endDate: true,
        budget: true,
        location: true,
        _count: { select: { teamMembers: true, tasks: true } },
        teamMembers: {
          take: 5,
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
      },
    });
  }

  // ─── CONTACTS ─────────────────────────────────────────────────────────────
  async getContacts(companyId: string, adminId: string, query: PaginationQueryDto) {
    await this.verifyOwner(companyId, adminId);

    const { page = 1, limit = 20 } = query;

    // ✅ সব members একসাথে আনো — pagination পরে grouped data তে apply হবে
    const members = await this.prisma.projectMember.findMany({
      where: {
        project: { companyId },
        role: { in: ['manager', 'worker'] },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: {
        project: {
          select: { id: true, name: true },
        },
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
    });

    // ✅ User দিয়ে group করো
    const grouped = new Map<string, {
      userId: string;
      fullName: string;
      email: string;
      phone: string | null;
      avatarUrl: string | null;
      systemRole: string;
      projects: { id: string; name: string; role: string; joinedAt: Date }[];
    }>();

    for (const member of members) {
      const existing = grouped.get(member.user.id);
      if (existing) {
        existing.projects.push({
          id: member.project.id,
          name: member.project.name,
          role: member.role ?? 'worker',
          joinedAt: member.createdAt,
        });
      } else {
        grouped.set(member.user.id, {
          userId: member.user.id,
          fullName: member.user.fullName,
          email: member.user.email,
          phone: member.user.phone ?? null,
          avatarUrl: member.user.avatarUrl ?? null,
          systemRole: member.user.role ?? '',
          projects: [{
            id: member.project.id,
            name: member.project.name,
            role: member.role ?? 'worker',
            joinedAt: member.createdAt,
          }],
        });
      }
    }

    // ✅ Grouped array এর উপর pagination apply করো
    const allGrouped = Array.from(grouped.values());
    const total = allGrouped.length;
    const skip = (page - 1) * limit;
    const paginated = allGrouped.slice(skip, skip + limit);

    return {
      data: paginated,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }





  // ─── DOCUMENTS ────────────────────────────────────────────────────────────
  async getDocuments(companyId: string, adminId: string) {
    await this.verifyOwner(companyId, adminId);

    // Get all projects of this company, then their documents
    const projects = await this.prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    return this.prisma.document.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        fileType: true,
        fileSizeMb: true,
        uploadedAt: true,
        project: { select: { id: true, name: true } },
        uploadedByUser: { select: { id: true, fullName: true } },
      },
    });
  }

  async uploadDocument(
    companyId: string,
    projectId: string,
    adminId: string,
    file: MulterFile,
  ) {
    await this.verifyOwner(companyId, adminId);

    // Verify project belongs to this company
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) throw new NotFoundException('Project not found in this company');

    const fileSizeMb = file.size / (1024 * 1024);

    return this.prisma.document.create({
      data: {
        projectId,
        uploadedBy: adminId,
        fileName: file.originalname,
        fileUrl: `/uploads/documents/${file.filename}`,
        fileType: file.mimetype,
        fileSizeMb: Math.round(fileSizeMb * 100) / 100,
      },
    });
  }

  async deleteDocument(companyId: string, documentId: string, adminId: string) {
    await this.verifyOwner(companyId, adminId);

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { project: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.project.companyId !== companyId)
      throw new ForbiddenException('Document does not belong to this company');

    await this.prisma.document.delete({ where: { id: documentId } });
    return { message: 'Document deleted successfully' };
  }
}