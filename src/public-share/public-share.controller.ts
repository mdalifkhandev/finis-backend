import { Controller, Get, Param } from '@nestjs/common';
import { PublicShareService } from './public-share.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('public-share')
export class PublicShareController {
  constructor(private readonly publicShareService: PublicShareService) {}

  @Public()
  @Get('company/:token')
  getCompanyByShareToken(@Param('token') token: string) {
    return this.publicShareService.getCompanyByShareToken(token);
  }

  @Public()
  @Get('project/:token')
  getProjectByShareToken(@Param('token') token: string) {
    return this.publicShareService.getProjectByShareToken(token);
  }
}
