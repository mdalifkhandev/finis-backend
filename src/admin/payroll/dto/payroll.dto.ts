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

// ─── Update Payroll ─────────────────────────────────────────────────────────
export class UpdatePayrollDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  regularHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  ratePerHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deductions?: number;

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
  @IsString()
  projectId!: string;

  @IsString()
  workerId!: string;

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
