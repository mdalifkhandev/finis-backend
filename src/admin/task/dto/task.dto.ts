import { ArrayNotEmpty, IsArray, IsString, IsOptional, IsNumber, IsEnum, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
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
  @IsArray()
  @IsUUID('4', { each: true })
  floorIds?: string[];

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  unitIds?: string[];

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
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  floorIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  unitIds?: string[];

  @IsOptional()
  @IsNumber()
  estimatedHours?: number;

  @IsOptional()
  @IsNumber()
  actualHours?: number;

  @IsOptional()
  @IsString()
  expenseDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expenseAmount?: number;
}

export class UpdateTaskStatusDto {
@IsEnum(TaskStatus)
  status!: TaskStatus;
}

export class AssignTaskDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  unitIds!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class CreateSubTaskDto {
  @IsOptional()
  @IsUUID('4')
  unitId?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  unitIds?: string[];

  @IsOptional()
  @IsUUID('4')
  taskAssigneeId?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ReviewTaskDto {
  @IsString()
  reviewDecision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  reviewDescription?: string;
}
