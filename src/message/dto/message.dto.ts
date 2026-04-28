import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsArray,
  IsNotEmpty,
  IsBoolean,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export enum ThreadType {
  DIRECT = 'direct',
  GROUP = 'group',
  PROJECT = 'project',
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
  targetUserId!: string; // The person to chat with
}

export class CreateGroupThreadDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @IsUUID('all', { each: true })
  participantIds!: string[];

  @IsOptional()
  @IsUUID()
  projectId?: string;
}

export class UpdateThreadDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
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

// Socket.io payload (used in Gateway)
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
  @IsEnum(ThreadType)
  type?: ThreadType; // filter by direct / group / project

  @IsOptional()
  @IsString()
  search?: string; // search by participant name or thread name

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
// PARTICIPANT DTOs
// ─────────────────────────────────────────────

export class AddParticipantDto {
  @IsArray()
  @IsUUID('all', { each: true })
  userIds!: string[];
}

export class RemoveParticipantDto {
  @IsUUID()
  userId!: string;
}