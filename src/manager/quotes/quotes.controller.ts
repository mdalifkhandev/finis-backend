import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import { CreateQuoteDto, UpdateQuoteDto } from './dto/quote.dto';
import { QuotesService } from './quotes.service';

@Controller('manager/quotes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin, UserRole.manager)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  createQuote(
    @Body() dto: CreateQuoteDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.quotesService.createQuote(dto, userId);
  }

  @Get()
  getQuotes(
    @CurrentUser('id') userId: string,
    @Query('projectType') projectType?: string,
    @Query('propertyType') propertyType?: string,
    @Query('unitType') unitType?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.quotesService.getQuotes(userId, { projectType, propertyType, unitType, categoryId });
  }

  @Get('categories')
  getQuoteCategories() {
    return this.quotesService.getActiveQuoteCategories();
  }

  @Get(':id')
  getQuoteById(
    @Param('id') id: string,
  ) {
    return this.quotesService.getQuoteById(id);
  }

  @Put(':id')
  updateQuote(
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotesService.updateQuote(id, dto);
  }

  @Delete(':id')
  deleteQuote(@Param('id') id: string) {
    return this.quotesService.deleteQuote(id);
  }
}
