import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { snakeCase } from 'typeorm/util/StringUtils';
import { fmtLocalDateTime } from '../utils/fmt-local.util';

/**
 * Phase 4 — 响应字段名 camelCase → snake_case 转换拦截器
 *
 * 与 garment-server Express 端兼容(Express 用 better-sqlite3 原生 .all()
 * 直接返回 DB 列名,即 snake_case)。
 *
 * 转换规则:
 *   - 对象所有 key 转 snake_case(用 typeorm snakeCase,词边界识别,避免 B2-3 缩写误拆)
 *   - 数组逐项转换
 *   - null/undefined/原始类型不动
 *   - 嵌套对象递归
 *   - Date → fmtLocalDateTime(本地时间,不用 toISOString,符合项目 CLAUDE.md)
 */

function transform(value: any): any {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return fmtLocalDateTime(value);
  if (Array.isArray(value)) return value.map(transform);
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      // B2-3 修复:用 typeorm snakeCase(词边界识别)替代正则
      // 避免 URL → _u_r_l / APIURL → _a_p_i_u_r_l 这种缩写误拆
      out[snakeCase(k)] = transform(v);
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