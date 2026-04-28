import {
  IsString,
  IsOptional,
  IsInt,
  IsUUID,
  IsEnum,
  IsNumber,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

// ─────────────────────────────────────────────
// Inventory Item DTOs
// ─────────────────────────────────────────────

export class CreateInventoryItemDto {

  @IsUUID()
  projectId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  currentQty?: number;

  @IsOptional()
  @IsNumber()
  minStockQty?: number;

  @IsOptional()
  @IsString()
  unit?: string;
}

export class UpdateInventoryItemDto extends PartialType(CreateInventoryItemDto) {}

export class UpdateStockDto {
  @IsInt()
  @IsNotEmpty()
  quantity!: number; // positive = restock, negative = usage

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;
}

// ─────────────────────────────────────────────
// Inventory Damage DTOs
// ─────────────────────────────────────────────

export enum InventoryDamageStatus {
  UNRESOLVED = 'unresolved',
  IN_REPAIR = 'in_repair',
  RESOLVED = 'resolved',
  WRITTEN_OFF = 'written_off',
}

export class CreateInventoryDamageDto {
  @IsUUID()
  inventoryId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  qtyDamaged!: number;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

export class UpdateDamageStatusDto {
  @IsEnum(InventoryDamageStatus)
  status!: InventoryDamageStatus;
}

// ─────────────────────────────────────────────
// Query / Filter DTOs
// ─────────────────────────────────────────────

export class InventoryQueryDto {
  @IsOptional()
@IsUUID()
projectId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  location?: string;

  /** Filter: only low stock items */
  @IsOptional()
  lowStock?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;
}