import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Phase 4 — 响应字段名 camelCase → snake_case 转换拦截器
 *
 * 与 garment-server Express 端兼容(Express 用 better-sqlite3 原生 .all()
 * 直接返回 DB 列名,即 snake_case)。
 *
 * 转换规则:
 *   - 对象所有 key 转 snake_case
 *   - 数组逐项转换
 *   - null/undefined/原始类型不动
 *   - 嵌套对象递归
 *   - Date 转 ISO string(避免 Date 序列化问题)
 */

function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, (_, c) => '_' + c.toLowerCase()).replace(/^_/, '');
}

function transform(value: any): any {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(transform);
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[toSnake(k)] = transform(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class SnakeCaseResponseInterceptor implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => transform(data)));
  }
}