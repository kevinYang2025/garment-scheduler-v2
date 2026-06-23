import {
  IsString,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 7 — Warehouse DTO
 *
 * 简化 DTO(§3.4 + §7.1:默认 IsOptional,Service 整段照搬)
 */

export class CreateInboundDto {
  @IsOptional()
  @IsString()
  ref_type?: string;

  @IsOptional()
  @IsString()
  operator?: string;  // Express SQL 包含 operator(controller 已从 session 取,这里是覆盖值)

  @IsOptional()
  @Type(() => Number)
  ref_id?: number;

  @IsOptional()
  @IsString()
  style_no?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size_spec?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  qty?: number;

  @IsOptional()
  @IsString()
  inbound_date?: string;

  // 面料库扩展字段
  @IsOptional() @IsString() pot_no?: string;
  @IsOptional() @IsString() fabric_name?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() width?: string;
  @IsOptional() @IsString() weight?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @Type(() => Number) @Min(0) total_pcs?: number;
  @IsOptional() @IsString() unit2?: string;
  @IsOptional() @IsString() remark?: string;

  // ALTER 新增字段
  @IsOptional() @IsString() order_no?: string;  // 自动生成
  @IsOptional() @Type(() => Number) @Min(0) loading_qty?: number;
}

export class CreateOutboundDto {
  @IsOptional()
  @IsString()
  ref_type?: string;

  @IsOptional()
  @IsString()
  operator?: string;

  @IsOptional()
  @Type(() => Number)
  ref_id?: number;

  @IsOptional()
  @IsString()
  style_no?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size_spec?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  qty?: number;

  @IsOptional()
  @IsString()
  outbound_date?: string;

  @IsOptional() @IsString() pot_no?: string;
  @IsOptional() @IsString() fabric_name?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() unit?: string;  // Fix #6:outbound 也记录单位(对齐 inbound)
  @IsOptional() @IsString() remark?: string;
}