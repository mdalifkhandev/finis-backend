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
  LOCATION = 'location',
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
}

export class MessageQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

// ─────────────────────────────────────────────
// SUPPORT DTOs
// ─────────────────────────────────────────────

export class StartSupportThreadDto {
  @IsOptional()
  @IsUUID()
  targetUserId?: string;
}

export class BlockUserDto {
  @IsUUID()
  targetUserId!: string;
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
