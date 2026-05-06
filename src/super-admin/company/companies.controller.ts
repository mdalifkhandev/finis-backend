import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { File as MulterFile } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SuperAdminCompaniesService } from './companies.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../generated/prisma/client';
import {
  GetCompaniesQueryDto,
  CreateCompanyDto,
  UpdateCompanyDto,
  ContactCompanyDto,
  PaginationQueryDto,
} from './dto/companies.dto';

const logoStorage = diskStorage({
  destination: './uploads/logos',
  filename: (_, file, cb) =>
    cb(null, `${uuidv4()}${extname(file.originalname)}`),
});

const docStorage = diskStorage({
  destination: './uploads/documents',
  filename: (_, file, cb) =>
    cb(null, `${uuidv4()}${extname(file.originalname)}`),
});

@Controller('super-admin/companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.super_admin)
export class SuperAdminCompaniesController {
  constructor(private readonly companiesService: SuperAdminCompaniesService) { }

  // Upload document

  // ─── STAT CARDS ───────────────────────────────────────────────────────────
  // image: Total Companies | Active Companies | Total Revenue | Avg Revenue
  // Query: ?period=monthly (TODAY / WEEKLY / MONTHLY / YEARLY / CUSTOM)
  //        For CUSTOM: ?period=custom&startDate=2024-01-01&endDate=2024-06-30
  @Get('stats')
  getCompanyStats(@Query() query: GetCompaniesQueryDto) {
    return this.companiesService.getCompanyStats(query);
  }

  // ─── LIST ─────────────────────────────────────────────────────────────────
  // image: search bar + All Industries + All Status + Grid/List toggle
  // Query: ?search=&industry=construction&status=active&page=1&limit=20
  @Get()
  getAllCompanies(@Query() query: GetCompaniesQueryDto) {
    return this.companiesService.getAllCompanies(query);
  }

  // ─── CREATE ───────────────────────────────────────────────────────────────
  // image: ADD NEW COMPANY modal
  // FIX: pass @CurrentUser('id') as adminId so ownerId defaults to the admin
  //      when no explicit ownerId is provided in the body
  @Post()
  @UseInterceptors(FileInterceptor('logo', { storage: logoStorage }))
  createCompany(
    @Body() dto: CreateCompanyDto,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.companiesService.createCompany(dto, file?.filename);
  }

  // ─── PROFILE ──────────────────────────────────────────────────────────────
  // image: Overview tab — About Company + stats + Direct Contact + chart + certifications
  @Get(':id')
  getCompanyProfile(@Param('id', ParseUUIDPipe) companyId: string) {
    return this.companiesService.getCompanyProfile(companyId);
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────────
  // image: EDIT COMPANY PROFILE modal
  @Put(':id')
  @UseInterceptors(FileInterceptor('logo', { storage: logoStorage }))
  updateCompany(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Body() dto: UpdateCompanyDto,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.companiesService.updateCompany(companyId, dto, file?.filename);
  }

  // ─── SOFT DELETE ──────────────────────────────────────────────────────────
  @Delete(':id')
  deleteCompany(@Param('id', ParseUUIDPipe) companyId: string) {
    return this.companiesService.deleteCompany(companyId);
  }

  // ─── TOGGLE STATUS ────────────────────────────────────────────────────────
  @Patch(':id/toggle-status')
  toggleStatus(@Param('id', ParseUUIDPipe) companyId: string) {
    return this.companiesService.toggleCompanyStatus(companyId);
  }

  // ─── TABS ─────────────────────────────────────────────────────────────────

  // image: "Projects 3" tab
  @Get(':id/projects')
  getCompanyProjects(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.companiesService.getCompanyProjects(companyId, query);
  }


  // Performance tab (image: Completion % + Budget Adherence line chart)
  @Get(':id/performance')
  getCompanyPerformance(@Param('id', ParseUUIDPipe) companyId: string) {
    return this.companiesService.getCompanyPerformance(companyId);
  }

  // Documents tab
  @Get(':id/documents')
  getCompanyDocuments(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.companiesService.getCompanyDocuments(companyId, query);
  }

  // Upload document
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { storage: docStorage }))
  uploadCompanyDocument(
    @Param('id', ParseUUIDPipe) companyId: string,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.companiesService.uploadCompanyDocument(companyId, file);
  }
}