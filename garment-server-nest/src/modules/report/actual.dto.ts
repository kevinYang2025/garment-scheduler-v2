import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 6 — Actual DTO
 *
 * 与 Express server.js /api/actual 兼容:
 *   - 单条 create: POST /api/actual
 *   - 批量: POST /api/actual/batch,body = { records: ActualDto[] }
 */

export class CreateActualDto {
  @IsString()
  @IsNotEmpty({ message: 'error.400.report.style_no_required' })
  style_no: string;

  @IsInt()
  @Type(() => Number)
  style_id: number;

  @IsString()
  @IsNotEmpty({ message: 'error.400.report.production_date_required' })
  production_date: string;

  @IsOptional()
  @IsString()
  schedule_type?: string;

  @IsOptional()
  @IsString()
  secondary_type?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size_spec?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'error.400.report.completed_qty_negative' })
  completed_qty?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'error.400.report.defect_qty_negative' })
  defect_qty?: number;

  @IsOptional()
  @IsString()
  workshop?: string;

  @IsOptional()
  @IsString()
  line_team?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  worker_name?: string;

  @IsOptional()
  @IsString()
  start_time?: string;

  @IsOptional()
  @IsString()
  end_time?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  is_second_inspection?: number;
}

export class UpdateActualDto extends CreateActualDto {}

export class BatchActualDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'error.400.report.batch_empty' })
  @ValidateNested({ each: true })
  @Type(() => CreateActualDto)
  records: CreateActualDto[];
}