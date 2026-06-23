import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { fmtLocalDateTime } from '../utils/fmt-local.util';

/**
 * Phase 1 + Code Review Fix(2026-06-23) — 全局 HttpException Filter
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
 */

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

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
      // Fix #6:displayMessage 优先用 response.error(老 Express 行为)
      // 但 NestJS 业务通常只设 message,这时 fallback 到 message
      displayMessage = response.error ?? (typeof message === 'string' ? message : exception.message);
    }

    // Fix #6 + Fix #10:
    //   - error 字段:Express 兼容字段,值为错误消息文案(老前端读这里)
    //   - message 字段:NestJS 新字段(新前端读这里),值为 i18n key 或消息
    //   - timestamp:用 fmtLocalDateTime(项目要求本地时间,不要 toISOString)
    res.status(status).json({
      statusCode: status,
      message,
      error: displayMessage,
      path: req.url,
      timestamp: fmtLocalDateTime(new Date()),
    });
  }
}