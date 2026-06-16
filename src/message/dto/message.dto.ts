import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsArray,
  IsNotEmpty,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ThreadType {
  DIRECT = 'direct',
  GROUP = 'group',
}

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  AUDIO = 'audio',
}

// ─────────────────────────────────────────────
// THREAD DTOs
// ─────────────────────────────────────────────

export class CreateDirectThreadDto {
  @IsUUID()
  targetUserId!: string;
}

export class AddParticipantDto {
  @IsArray()
  @IsUUID('all', { each: true })
  userIds!: string[];
}

// ─────────────────────────────────────────────
// MESSAGE DTOs
// ─────────────────────────────────────────────

export class SendMessageDto {
  @IsUUID()
  threadId!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @IsOptional()
  @IsString()
  locationUrl?: string;
}

export class SocketMessageDto {
  threadId!: string;
  content?: string;
  mediaUrl?: string;
  mediaType?: MediaType;
  locationUrl?: string;
}

// ─────────────────────────────────────────────
// QUERY DTOs
// ─────────────────────────────────────────────

export class ThreadQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class MessageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

// ─────────────────────────────────────────────
// SUPPORT DTOs
// ─────────────────────────────────────────────

export class StartSupportThreadDto {
  @IsOptional()
  @IsUUID()
  targetUserId?: string;
}

export class AdminSendMessageDto {
  @IsUUID()
  threadId!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @IsOptional()
  @IsString()
  locationUrl?: string;
}
