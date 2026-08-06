import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { R2Service } from '../r2/r2.service';
import { S3Service } from '../s3/s3.service';

type StorageDriver = 'r2' | 's3';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly r2: R2Service,
    private readonly s3: S3Service,
  ) {}

  async uploadFile(file: Express.Multer.File, folder: string = 'uploads'): Promise<string> {
    const driver = this.getDriver();

    if (driver === 's3') {
      return this.s3.uploadFile(file, folder);
    }

    try {
      return await this.r2.uploadFile(file, folder);
    } catch (error) {
      this.logger.warn(`R2 upload failed, falling back to S3: ${this.errorMessage(error)}`);
      return this.s3.uploadFile(file, folder);
    }
  }

  async deleteFile(fileUrl: string): Promise<void> {
    const driver = this.getDriver();

    if (driver === 's3') {
      await this.s3.deleteFile(fileUrl);
      return;
    }

    await this.r2.deleteFile(fileUrl);
    await this.s3.deleteFile(fileUrl);
  }

  private getDriver(): StorageDriver {
    return this.config.get<string>('STORAGE_DRIVER') === 's3' ? 's3' : 'r2';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
