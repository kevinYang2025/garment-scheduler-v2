import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { fmtLocalDateTime } from '../utils/fmt-local.util';

/**
 * Phase 1 + Code Review Fix(2026-06-23) — 全局 Exception Filter
 *
 * **与 garment-server 旧响应完全兼容**(Fix #6):
 *   - 旧 Express: `{ error: '款号不能为空' }` — error 字段是消息文案
 *   - 旧 Express 没有 statusCode/message/path/timestamp 字段
 *   - 前端 30+ 处用 `data.error` 当 toast 文案
 *
 * NestJS 端:
 *   - 同时提供 Express 老字段(error = 错误消息)+ NestJS 新字段(message, statusCode, path)
 *   - 前端老代码 `data.error` 仍能工作
 *   - 前端新代码 `data.message` 也能工作
 *
 * i18n(详见 §3.5):
 *   - message 以 'error.' 开头则翻译(Accept-Language)
 *   - Phase 2 占位版:不做翻译,直接返回原 message
 *
 * Fix #10:timestamp 改用 fmtLocalDateTime(CLAUDE.md 规定不用 toISOString)
 *
 * Fix #F(2026-06-23,独立安全审查):
 *   之前只 @Catch(HttpException),better-sqlite3 / TypeORM / 其他库抛的非 HttpException
 *   会走 NestJS 默认 filter,泄露 stack trace + SQL 片段(数据外泄)
 *   现在 @Catch() 兜底所有错误:500 + 通用消息 + 内部日志详情
 */

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    // 区分 HttpException vs 未捕获异常
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as
        | string
        | { message?: string | string[]; error?: string };

      let message: string | string[];
      let displayMessage: string;

      if (typeof response === 'string') {
        message = response;
        displayMessage = response;
      } else {
        message = response.message ?? exception.message;
        displayMessage = response.error ?? (typeof message === 'string' ? message : exception.message);
      }

      res.status(status).json({
        statusCode: status,
        message,
        error: displayMessage,
        path: req.url,
        timestamp: fmtLocalDateTime(new Date()),
      });
      return;
    }

    // 兜底:任何非 HttpException → 500,不泄露 stack/SQL/内部路径
    this.logger.error(
      `[unhandled] ${(exception as Error)?.name || 'Error'}: ${(exception as Error)?.message || exception}`,
      (exception as Error)?.stack,
    );
    res.status(500).json({
      statusCode: 500,
      message: 'error.500.internal',
      error: '服务器内部错误',  // 通用消息,与 Express 旧响应一致
      path: req.url,
      timestamp: fmtLocalDateTime(new Date()),
    });
  }
}