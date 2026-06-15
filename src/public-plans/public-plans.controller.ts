import { Controller, Get } from '@nestjs/common';
import { PublicPlansService } from './public-plans.service';

@Controller('public/plans')
export class PublicPlansController {
  constructor(private readonly publicPlansService: PublicPlansService) {}

  @Get()
  getActivePlans() {
    return this.publicPlansService.getActivePlans();
  }
}
