import { IsString, IsNumber, IsOptional, IsDateString, Min } from 'class-validator';

// ─── Payroll Summary Query ────────────────────────────────────────────────────
export class PayrollSummaryQueryDto {
  @IsOptional()
  @IsString()
  month?: string;

  @IsOptional()
  @IsString()
  year?: string;
}

// ─── Approve Payroll ──────────────────────────────────────────────────────────
export class ApprovePayrollDto {
  @IsOptional()
  @IsString()
  note?: string;
}

// ─── Process Payroll ──────────────────────────────────────────────────────────
export class ProcessPayrollDto {
  @IsOptional()
  @IsString()
  month?: string;

  @IsOptional()
  @IsString()
  year?: string;
}

// ─── Create Payroll Manually ──────────────────────────────────────────────────
export class CreatePayrollDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  workerId!: string;

  @IsString()
  companyId!: string;

  @IsDateString()
  payPeriodStart!: string;

  @IsDateString()
  payPeriodEnd!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  regularHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeHours?: number;

  @IsNumber()
  @Min(0)
  ratePerHour!: number;
}