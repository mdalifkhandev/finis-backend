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
  @IsString()
  workerId!: string;

  @IsOptional()
  @IsString()
  companyId!: string;

  @IsString()
  projectId!: string;

  @IsDateString()
  payPeriodStart!: string;

  @IsDateString()
  payPeriodEnd!: string;

  @IsNumber()
  @Min(0)
  regularHours!: number;

  @IsNumber()
  @Min(0)
  overtimeHours!: number;

  @IsNumber()
  @Min(0)
  ratePerHour!: number;

  @IsNumber()
  @Min(0)
  grossPay!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deductions?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  netPay?: number;
}