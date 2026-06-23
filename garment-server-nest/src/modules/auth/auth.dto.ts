import { IsString, IsNotEmpty, MinLength, MaxLength, IsOptional } from 'class-validator';

/**
 * Phase 3 — Auth DTO
 *
 * §3.4 严格规则:
 *   - 字段默认 @IsOptional() — 旧请求不传不报错(whitelist 兜底)
 *   - 数字/日期转换由 ValidationPipe 的 enableImplicitConversion 处理
 *
 * 错误信息:Phase 2 接 i18n 后改成 'error.xxx' key,Phase 3 先用中文
 */

export class LoginDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  /** PIN 登录(dispatcher) */
  @IsOptional()
  @IsString()
  pin_no?: string;

  @IsOptional()
  @IsString()
  pin?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'error.400.auth.old_password_required' })
  old_password: string;

  @IsString()
  @MinLength(6, { message: 'error.400.auth.password_too_short' })
  @MaxLength(100, { message: 'error.400.auth.password_too_long' })
  @IsNotEmpty({ message: 'error.400.auth.new_password_required' })
  new_password: string;
}