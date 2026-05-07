import { IsOptional, IsString } from 'class-validator';

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