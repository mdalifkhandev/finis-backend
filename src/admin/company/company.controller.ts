import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { File as MulterFile } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CompanyService } from './company.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../generated/prisma/client';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  CreateContactDto,
  UpdateContactDto,
  PaginationQueryDto,
} from './dto/company.dto';

const logoStorage = diskStorage({
  destination: './uploads/logos',
  filename: (_, file, cb) => cb(null, `${uuidv4()}${extname(file.originalname)}`),
});

const docStorage = diskStorage({
  destination: './uploads/documents',
  filename: (_, file, cb) => cb(null, `${uuidv4()}${extname(file.originalname)}`),
});

@Controller('admin/companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.super_admin,)
export class CompanyController {
  constructor(private companyService: CompanyService) { }

  // ─── COMPANIES ────────────────────────────────────────────────────────────

  /** GET /admin/companies — all my companies */
  @Get()
  getMyCompanies(
    @CurrentUser('id') adminId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.companyService.getMyCompanies(adminId, query);
  }

  /** POST /admin/companies — create company */
  @Post()
  @UseInterceptors(FileInterceptor('logo', { storage: logoStorage }))
  createCompany(
    @Body() dto: CreateCompanyDto,
    @CurrentUser('id') adminId: string,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.companyService.createCompany(dto, adminId, file?.filename);
  }

  /** GET /admin/companies/:id — company profile */
  @Get(':id')
  getCompanyProfile(
    @Param('id') companyId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.companyService.getCompanyProfile(companyId, adminId);
  }

  /** PUT /admin/companies/:id — update company */
  @Put(':id')
  @UseInterceptors(FileInterceptor('logo', { storage: logoStorage }))
  updateCompany(
    @Param('id') companyId: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser('id') adminId: string,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.companyService.updateCompany(companyId, dto, adminId, file?.filename);
  }

  /** DELETE /admin/companies/:id — deactivate company */
  @Delete(':id')
  deleteCompany(
    @Param('id') companyId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.companyService.deleteCompany(companyId, adminId);
  }

  // ─── ASSIGNED PROJECTS ────────────────────────────────────────────────────

  /** GET /admin/companies/:id/projects */
  @Get(':id/projects')
  getAssignedProjects(
    @Param('id') companyId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.companyService.getAssignedProjects(companyId, adminId);
  }

  // ─── CONTACTS ─────────────────────────────────────────────────────────────

  /** GET /admin/companies/:id/contacts */
  @Get(':id/contacts')
  getContacts(
    @Param('id') companyId: string,
    @CurrentUser('id') adminId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.companyService.getContacts(companyId, adminId, query);
  }


  // ─── DOCUMENTS ────────────────────────────────────────────────────────────

  /** GET /admin/companies/:id/documents */
  @Get(':id/documents')
  getDocuments(
    @Param('id') companyId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.companyService.getDocuments(companyId, adminId);
  }

  /** POST /admin/companies/:id/documents — upload document */
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { storage: docStorage }))
  uploadDocument(
    @Param('id') companyId: string,
    @Query('projectId') projectId: string,
    @CurrentUser('id') adminId: string,
    @UploadedFile() file: MulterFile,
  ) {
    return this.companyService.uploadDocument(companyId, projectId, adminId, file);
  }

  /** DELETE /admin/companies/:id/documents/:docId */
  @Delete(':id/documents/:docId')
  deleteDocument(
    @Param('id') companyId: string,
    @Param('docId') docId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.companyService.deleteDocument(companyId, docId, adminId);
  }
}