import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../generated/prisma/client';
import { CreateQuoteCategoryDto, UpdateQuoteCategoryDto } from './dto/quote-category.dto';
import { QuoteCategoriesService } from './quote-categories.service';

@Controller('super-admin/quote-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.super_admin)
export class QuoteCategoriesController {
  constructor(private readonly quoteCategoriesService: QuoteCategoriesService) {}

  @Get()
  getQuoteCategories(@Query('activeOnly') activeOnly?: string) {
    return this.quoteCategoriesService.listQuoteCategories(activeOnly === 'true');
  }

  @Post()
  createQuoteCategory(@Body() dto: CreateQuoteCategoryDto) {
    return this.quoteCategoriesService.createQuoteCategory(dto);
  }

  @Patch(':id')
  updateQuoteCategory(@Param('id') id: string, @Body() dto: UpdateQuoteCategoryDto) {
    return this.quoteCategoriesService.updateQuoteCategory(id, dto);
  }

  @Delete(':id')
  deleteQuoteCategory(@Param('id') id: string) {
    return this.quoteCategoriesService.deleteQuoteCategory(id);
  }
}
