import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';

/**
 * Phase 2.3 — 请求日志 interceptor
 *
 * 记录:
 *   - 请求方法 + URL + IP + User-Agent
 *   - 响应状态码 + 耗时
 *   - 错误日志(异常路径)
 *
 * 不记录:
 *   - 请求 body(可能含密码等敏感字段,Phase 9 接入结构化日志再考虑)
 *   - 响应 body(太大,且敏感)
 *
 * 与 garment-server 无对应 — NestJS 新增,Phase 9 接入 pino 后可替换
 */

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = Date.now();

    const { method, originalUrl, ip } = req;
    const ua = (req.headers['user-agent'] || '').slice(0, 60);

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.log(`${method} ${originalUrl} ${res.statusCode} ${ms}ms ip=${ip} ua=${ua}`);
        },
        error: (err) => {
          const ms = Date.now() - start;
          const status = err?.status ?? 500;
          this.logger.warn(
            `${method} ${originalUrl} ${status} ${ms}ms ip=${ip} ua=${ua} ERR=${err?.message?.slice(0, 100) ?? 'unknown'}`,
          );
        },
      }),
    );
  }
}