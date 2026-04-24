import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectType, ProjectStatus } from '../../../generated/prisma/client';

export class CreateRoomDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sizeSqft?: number;
}

export class CreateFloorDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Type(() => Number)
  floorNumber?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoomDto)
  rooms?: CreateRoomDto[];
}

export class CreateProjectDto {
  @IsString()
  name!: string;

  @IsString()
  companyId!: string;

  @IsOptional()
  @IsEnum(ProjectType)
  type?: ProjectType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  budget?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  numFloors?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  roomsPerFloor?: number;

  @IsOptional()
  @IsBoolean()
  autoGenerateFloors?: boolean; // auto-generate floors & rooms

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFloorDto)
  floors?: CreateFloorDto[];
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ProjectType)
  type?: ProjectType;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  budget?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AddFloorDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Type(() => Number)
  floorNumber!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoomDto)
  rooms?: CreateRoomDto[];
}

export class AddRoomDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sizeSqft?: number;
}

export class AddProjectMemberDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  role?: string;
}

export class CreateGeofenceDto {
  @IsString()
  zoneName!: string;

  @IsNumber()
  @Type(() => Number)
  centerLat!: number;

  @IsNumber()
  @Type(() => Number)
  centerLng!: number;

  @IsNumber()
  @Type(() => Number)
  radiusMeters!: number;

  @IsOptional()
  @IsString()
  polygonCoords?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  totalAreaSqft?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  perimeterFt?: number;
}