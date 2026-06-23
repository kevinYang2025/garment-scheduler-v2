import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 4 — Style DTO
 *
 * 校验规则与 garment-server/server.js validateStyle 完全一致:
 *   - style_no 必填,长度 ≤ 50
 *   - product_name 长度 ≤ 100
 *   - plan_qty ≥ 0
 *   - 4 个日产量字段(target/embroidery/printing/ironing/template) ≥ 0
 *
 * §3.4 严格规则 + @IsOptional() 兜底
 */

export class CreateStyleDto {
  @IsString()
  @IsNotEmpty({ message: 'error.400.style.style_no_required' })
  @MaxLength(50, { message: 'error.400.style.style_no_too_long' })
  style_no: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'error.400.style.product_name_too_long' })
  product_name?: string;

  @IsOptional()
  @IsString()
  style_category?: string;

  @IsOptional()
  @IsString()
  fabric_code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'error.400.style.plan_qty_not_int' })
  @Min(0, { message: 'error.400.style.plan_qty_negative' })
  plan_qty?: number;

  @IsOptional()
  @IsString()
  due_date?: string;

  @IsOptional()
  @IsString()
  order_date?: string;

  @IsOptional()
  @IsString()
  embroidery?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'error.400.style.daily_output_negative' })
  embroidery_daily_output?: number;

  @IsOptional()
  @IsString()
  printing?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'error.400.style.daily_output_negative' })
  printing_daily_output?: number;

  @IsOptional()
  @IsString()
  ironing_label?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'error.400.style.daily_output_negative' })
  ironing_daily_output?: number;

  @IsOptional()
  @IsString()
  template?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'error.400.style.daily_output_negative' })
  template_daily_output?: number;

  @IsOptional()
  @IsString()
  tt_time?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'error.400.style.daily_output_negative' })
  target_daily_output?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  has_special_wash?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateStyleDto extends CreateStyleDto {
  // PUT 沿用 Create 的所有字段
  // Express 逻辑:id 来自 URL,不允许 body.id 覆盖
}