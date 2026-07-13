import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuoteCategoryDto, UpdateQuoteCategoryDto } from './dto/quote-category.dto';

@Injectable()
export class QuoteCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listQuoteCategories(activeOnly = false) {
    return this.prisma.quoteCategory.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createQuoteCategory(dto: CreateQuoteCategoryDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Quote category name is required');

    const existing = await this.prisma.quoteCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('Quote category already exists');
    }

    return this.prisma.quoteCategory.create({
      data: {
        name,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateQuoteCategory(id: string, dto: UpdateQuoteCategoryDto) {
    const category = await this.prisma.quoteCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Quote category not found');

    if (dto.name) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Quote category name is required');
      const duplicate = await this.prisma.quoteCategory.findFirst({
        where: {
          id: { not: id },
          name: { equals: name, mode: 'insensitive' },
        },
      });
      if (duplicate) {
        throw new ConflictException('Quote category already exists');
      }

      return this.prisma.quoteCategory.update({
        where: { id },
        data: {
          name,
          isActive: dto.isActive ?? category.isActive,
          sortOrder: dto.sortOrder ?? category.sortOrder,
        },
      });
    }

    return this.prisma.quoteCategory.update({
      where: { id },
      data: {
        isActive: dto.isActive ?? category.isActive,
        sortOrder: dto.sortOrder ?? category.sortOrder,
      },
    });
  }

  async deleteQuoteCategory(id: string) {
    const category = await this.prisma.quoteCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Quote category not found');

    await this.prisma.quoteCategory.delete({ where: { id } });
    return { success: true, message: 'Quote category deleted successfully' };
  }
}
