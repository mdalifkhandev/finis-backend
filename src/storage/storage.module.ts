import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { R2Module } from '../r2/r2.module';
import { S3Module } from '../s3/s3.module';
import { StorageService } from './storage.service';

@Module({
  imports: [ConfigModule, R2Module, S3Module],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
