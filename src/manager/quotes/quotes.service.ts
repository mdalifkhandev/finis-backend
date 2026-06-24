import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuoteDto, UpdateQuoteDto } from './dto/quote.dto';

@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async findQuoteByIdOrSlug(identifier: string) {
    const byId = await this.prisma.quote.findUnique({
      where: { id: identifier },
    });

    if (byId) return byId;

    const normalized = this.slugify(identifier);
    return this.prisma.quote.findFirst({
      where: {
        OR: [
          { title: { equals: identifier, mode: 'insensitive' } },
          { title: { equals: normalized.replace(/-/g, ' '), mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createQuote(dto: CreateQuoteDto, userId: string) {
    const quantity = dto.quantity ?? 1;
    const unitPrice = dto.unitPrice ?? 0;
    const subtotal = Math.round(quantity * unitPrice * 100) / 100;

    return this.prisma.quote.create({
      data: {
        projectType: dto.projectType,
        propertyType: dto.propertyType,
        unitType: dto.unitType,
        title: dto.title,
        quantity,
        unit: dto.unit ?? null,
        unitPrice,
        subtotal,
        notes: dto.notes ?? null,
        isCustom: dto.isCustom ?? false,
        createdBy: {
          connect: { id: userId },
        },
      },
      include: {
        createdBy: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
      },
    });
  }

  async getQuotes(userId: string, filters?: { projectType?: string; propertyType?: string; unitType?: string }) {
    const quotes = await this.prisma.quote.findMany({
      where: {
        ...(filters?.projectType && { projectType: filters.projectType }),
        ...(filters?.propertyType && { propertyType: filters.propertyType }),
        ...(filters?.unitType && { unitType: filters.unitType }),
      },
      include: {
        createdBy: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      total: quotes.length,
      quotes,
      requestedBy: userId,
    };
  }

  async getQuoteById(id: string) {
    const quote = await this.findQuoteByIdOrSlug(id);

    if (!quote) throw new NotFoundException('Quote not found');
    return this.prisma.quote.findUnique({
      where: { id: quote.id },
      include: {
        createdBy: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
      },
    });
  }

  async updateQuote(id: string, dto: UpdateQuoteDto) {
    const quote = await this.findQuoteByIdOrSlug(id);
    if (!quote) throw new NotFoundException('Quote not found');

    const quantity = dto.quantity ?? quote.quantity;
    const unitPrice = dto.unitPrice ?? quote.unitPrice;
    const subtotal = Math.round(quantity * unitPrice * 100) / 100;

    return this.prisma.quote.update({
      where: { id: quote.id },
      data: {
        projectType: dto.projectType ?? quote.projectType,
        propertyType: dto.propertyType ?? quote.propertyType,
        unitType: dto.unitType ?? quote.unitType,
        title: dto.title ?? quote.title,
        quantity,
        unit: dto.unit ?? quote.unit,
        unitPrice,
        subtotal,
        notes: dto.notes ?? quote.notes,
        isCustom: dto.isCustom ?? quote.isCustom,
      },
      include: {
        createdBy: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
      },
    });
  }

  async deleteQuote(id: string) {
    const quote = await this.findQuoteByIdOrSlug(id);
    if (!quote) throw new NotFoundException('Quote not found');
    await this.prisma.quote.delete({ where: { id: quote.id } });
    return { success: true, message: 'Quote deleted successfully' };
  }
}
