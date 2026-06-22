import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Phase 1 占位 — 全局 HttpException Filter
 *
 * Phase 1 目标:统一响应体 { statusCode, message, error },与旧 Express 兼容
 * Phase 2 起接 i18n(详见 §3.5):
 *   - message 以 'error.' 开头则翻译
 *   - 通过 Accept-Language 切换语言
 *
 * 当前实现:不做翻译,直接返回原 message
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
    let error: string;

    if (typeof response === 'string') {
      message = response;
      error = HttpStatus[status] || 'Error';
    } else {
      message = response.message ?? exception.message;
      error = response.error ?? HttpStatus[status] ?? 'Error';
    }

    // 与 garment-server 旧响应完全兼容
    res.status(status).json({
      statusCode: status,
      message,
      error,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}