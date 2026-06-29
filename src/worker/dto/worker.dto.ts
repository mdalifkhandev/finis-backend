import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  Min,
  IsArray,
  IsEnum,
  IsDateString,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LocationEventType } from '../../generated/prisma/client';

// ── TASK ──────────────────────────────────────────────────────────────────────

export class InventoryUsedItemDto {
  @IsUUID('4')
  inventoryId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qtyUsed!: number;
}

export class SubmitTaskReportDto {
  @IsOptional()
  @IsString()
  beforePhotoUrl?: string;

  @IsOptional()
  @IsString()
  afterPhotoUrl?: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryUsedItemDto)
  inventoryUsed?: InventoryUsedItemDto[];
}

export class CreateSubTaskDto {
  @IsOptional()
  @IsUUID('4')
  unitId?: string;

  @IsOptional()
  @IsArray()
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

export class UpdateTaskInventoryDto {
  @IsInt()
  @Min(1)
  qtyUsed!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ── ATTENDANCE ────────────────────────────────────────────────────────────────

export class CheckInDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CheckOutDto {
  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ── LEAVE REQUEST ─────────────────────────────────────────────────────────────

export class CreateLeaveRequestDto {
  @IsEnum(['sick', 'vacation', 'personal', 'emergency', 'unpaid'])
  leaveType!: 'sick' | 'vacation' | 'personal' | 'emergency' | 'unpaid';

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ── PROFILE ───────────────────────────────────────────────────────────────────

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  newPassword!: string;
}

// ── SUPPORT ───────────────────────────────────────────────────────────────────

export class CreateSupportRequestDto {
  @IsEnum(['admin', 'manager'])
  sendTo!: 'admin' | 'manager';

  @IsString()
  message!: string;
}

// ── LOCATION ──────────────────────────────────────────────────────────────────

export class UpdateLocationDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsOptional()
  @IsString()
  geofenceId?: string;

  @IsOptional()
  @IsEnum(LocationEventType)
  eventType?: LocationEventType;
}
