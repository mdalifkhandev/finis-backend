import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { ExpenseCategory } from '../../../generated/prisma/client';

export class ExpenseQueryDto {
  @IsOptional()
  @IsString()
  status?: string;        // pending | approved | rejected

  @IsOptional()
  @IsString()
  search?: string;        // worker name or description

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  month?: string;

  @IsOptional()
  @IsString()
  year?: string;
}

export class ReviewExpenseDto {
  @IsOptional()
  @IsString()
  reviewNotes?: string;
}

export class UpdateExpenseProjectDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  taskId?: string;
}

export class CreateExpenseDto {
  @IsUUID()
  workerId!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsString()
  description!: string;

  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @IsDateString()
  date!: string;
}