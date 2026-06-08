import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsArray,
  IsNotEmpty,
} from 'class-validator';

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
}

export class SocketMessageDto {
  threadId!: string;
  content?: string;
  mediaUrl?: string;
  mediaType?: MediaType;
}

// ─────────────────────────────────────────────
// QUERY DTOs
// ─────────────────────────────────────────────

export class ThreadQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 20;
}

export class MessageQueryDto {
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 30;
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
}