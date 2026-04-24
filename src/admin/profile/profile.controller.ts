import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UpdateProfileDto, ChangePasswordDto } from './dto/profile.dto';
import type { File as MulterFile } from 'multer';

const avatarStorage = diskStorage({
  destination: './uploads/avatars',
  filename: (_, file, cb) => cb(null, `${uuidv4()}${extname(file.originalname)}`),
});

@Controller('admin/profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private profileService: ProfileService) {}

  /** GET /admin/profile */
  @Get()
  getProfile(@CurrentUser('id') userId: string) {
    return this.profileService.getProfile(userId);
  }

  /** PUT /admin/profile — profile update (avatar optional) */
  @Put()
  @UseInterceptors(FileInterceptor('avatar', { storage: avatarStorage }))
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.profileService.updateProfile(userId, dto, file);
  }

  /** PUT /admin/profile/change-password */
  @Put('change-password')
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.profileService.changePassword(userId, dto);
  }
}