import { ValidationPipe, BadRequestException } from '@nestjs/common';

/**
 * Phase 2.3 — 全局 ValidationPipe(§3.4 严格规则)
 *
 * 关键配置:
 *   - whitelist: true — 静默丢弃未声明字段(避免旧请求 400)
 *   - forbidNonWhitelisted: false — 不报 400(与 Express 兼容)
 *   - transform: true — 自动类型转换
 *   - enableImplicitConversion: true — 数字/字符串互转
 *
 * DTO 校验失败时 class-validator 抛 BadRequestException,
 * 错误信息聚合为字符串数组,与旧 Express 行为一致。
 *
 * 与 garment-server 无对应(Express 用 middleware/手动校验),
 * Phase 2 引入,DTO 上 @IsOptional() 兜底,详见 §3.4。
 */

export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    // 把 class-validator 错误聚合成字符串数组,前端可遍历显示
    exceptionFactory: (errors) => {
      const messages = errors.flatMap((err) =>
        Object.values(err.constraints || {}),
      );
      return new BadRequestException({
        message: messages.length > 0 ? messages : ['参数校验失败'],
        error: 'ValidationError',
      });
    },
  });
}