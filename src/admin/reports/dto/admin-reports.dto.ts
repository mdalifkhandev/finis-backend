import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { PeriodFrequency, ReportType } from '../../../super-admin/reports/dto/reports.dto';

export class AdminGenerateReportDto {
  @IsEnum(ReportType)
  type!: ReportType;

  @IsEnum(PeriodFrequency)
  frequency!: PeriodFrequency;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

export class AdminExportReportDto {
  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
