import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsNumber,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 5 — MainPlan DTO
 *
 * DTO 用 snake_case(与前端 + Express 兼容)
 * entity 用 camelCase(TypeORM 习惯)
 * 转换在 service 里做
 */

export class CreateMainPlanDto {
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'error.400.plan.style_id_invalid' })
  style_id: number;

  @IsOptional()
  @IsString()
  style_no?: string;

  @IsOptional()
  @IsString()
  product_name?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  plan_qty?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'error.400.plan.due_date_format',
  })
  due_date?: string;

  @IsOptional()
  @IsString()
  cutting_start?: string;

  @IsOptional()
  @IsString()
  cutting_end?: string;

  @IsOptional()
  @IsString()
  sewing_start?: string;

  @IsOptional()
  @IsString()
  sewing_end?: string;

  @IsOptional()
  @IsString()
  workshop?: string;

  @IsOptional()
  @IsString()
  line_team?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  pipeline_count?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  priority?: number;
}

export class UpdateMainPlanDto extends CreateMainPlanDto {}

export class AutoScheduleDto {
  /** 必须指定 style_id(单款式自动排产) */
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'error.400.plan.style_id_invalid' })
  style_id: number;
}

export class DateParamDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'error.400.common.date_format',
  })
  date: string;
}