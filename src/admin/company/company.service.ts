import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto, CreateContactDto, UpdateContactDto } from './dto/company.dto';
import { File as MulterFile } from 'multer';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

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
  async getMyCompanies(adminId: string) {
    return this.prisma.company.findMany({
      where: { ownerId: adminId, isActive: true },
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
    });
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
  async getContacts(companyId: string, adminId: string) {
    await this.verifyOwner(companyId, adminId);
    return this.prisma.contact.findMany({
      where: { companyId },
      orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
    });
  }

  async createContact(companyId: string, dto: CreateContactDto, adminId: string) {
    await this.verifyOwner(companyId, adminId);

    // Only one primary contact allowed
    if (dto.isPrimary) {
      await this.prisma.contact.updateMany({
        where: { companyId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return this.prisma.contact.create({
      data: {
        companyId,
        fullName: dto.fullName!,
        role: dto.role,
        email: dto.email,
        phone: dto.phone,
        isPrimary: dto.isPrimary ?? false,
      },
    });
  }

  async updateContact(
    companyId: string,
    contactId: string,
    dto: UpdateContactDto,
    adminId: string,
  ) {
    await this.verifyOwner(companyId, adminId);

    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, companyId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    if (dto.isPrimary) {
      await this.prisma.contact.updateMany({
        where: { companyId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return this.prisma.contact.update({
      where: { id: contactId },
      data: dto,
    });
  }

  async deleteContact(companyId: string, contactId: string, adminId: string) {
    await this.verifyOwner(companyId, adminId);

    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, companyId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    await this.prisma.contact.delete({ where: { id: contactId } });
    return { message: 'Contact deleted successfully' };
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

  // ─── COMPANY MEMBERS ──────────────────────────────────────────────────────
  async getMembers(companyId: string, adminId: string) {
    await this.verifyOwner(companyId, adminId);

    return this.prisma.companyMember.findMany({
      where: { companyId },
      select: {
        id: true,
        role: true,
        joinedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            role: true,
            status: true,
          },
        },
      },
    });
  }
}