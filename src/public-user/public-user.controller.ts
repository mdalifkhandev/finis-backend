import { Controller, Get, Param } from '@nestjs/common';
import { PublicUserService } from './public-user.service';

@Controller('public/users')
export class PublicUserController {
  constructor(private readonly publicUserService: PublicUserService) {}

  /** GET /public/users/:id */
  @Get(':id')
  getUserById(@Param('id') userId: string) {
    return this.publicUserService.getUserById(userId);
  }
}
