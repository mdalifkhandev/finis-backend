import { ArrayNotEmpty, IsArray, IsString, IsOptional, IsNumber, IsEnum, IsUUID } from 'class-validator';
import { TaskPriority, TaskStatus } from '../../../generated/prisma/client';

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  projectId!: string;

  @IsOptional()
  @IsString()
  floorId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  estimatedHours?: number;
}

export class UpdateTaskDto {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  estimatedHours?: number;
  actualHours?: number;
}

export class UpdateTaskStatusDto {
@IsEnum(TaskStatus)
  status!: TaskStatus;
}

export class AssignTaskDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class ReviewTaskDto {
  @IsString()
  reviewDecision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  reviewDescription?: string;
}