import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationLog } from '../../entity/operation-log.entity';
import { SessionUser } from '../auth/auth.guard';

/**
 * Phase 2.4 — OperationLoggerService(横切 service)
 *
 * 任何 module 注入此 service 即可写操作日志:
 *   constructor(private opLog: OperationLoggerService) {}
 *   await this.opLog.log({ module: 'main_plan', action: 'create', targetId, targetName, payload, user });
 *
 * 与 garment-server/db.js logOperation + server.js logOp 完全等价:
 *   - logOperation(module, action, targetId, targetName, detail, userId)
 *   - logOp(req, module, action, targetId, targetName, detail) [包装函数,自动从 req 取 userId]
 *
 * 失败处理:log 失败不能阻塞业务,但 stderr 警告(便于运维发现)
 */

export interface OperationLogInput {
  module: string;
  action: string;
  targetId?: number | null;
  targetName?: string;
  detail?: string;
  user?: SessionUser | null;
}

@Injectable()
export class OperationLoggerService {
  private readonly logger = new Logger('OperationLog');

  constructor(
    @InjectRepository(OperationLog)
    private readonly repo: Repository<OperationLog>,
  ) {}

  /**
   * 记录一条操作日志
   * @returns 插入的 id;失败返回 null(不抛错,业务继续)
   */
  async log(input: OperationLogInput): Promise<number | null> {
    try {
      // B2-4 修复:user 缺省时 operator 设为 null(不再写 'YC' 占位)
      // 审计完整性:不知道是谁操作就明确留 null,不要假数据
      const username = input.user?.username ?? null;
      const row = this.repo.create({
        module: input.module,
        action: input.action,
        targetId: input.targetId ?? null,
        targetName: input.targetName ?? '',
        detail: input.detail ?? '',
        operator: username ?? undefined,
        userId: input.user?.id ?? null,
      } as Partial<OperationLog>);
      const saved = await this.repo.save(row);
      return (saved as OperationLog).id ?? null;
    } catch (err) {
      this.logger.error(
        `log(${input.module}.${input.action}, target=${input.targetId}) 失败: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 从 req.user 自动取用户信息
   */
  async logFromReq(
    req: { user?: SessionUser | null; session?: { user?: SessionUser } },
    module: string,
    action: string,
    targetId?: number | null,
    targetName?: string,
    detail?: string,
  ): Promise<number | null> {
    const user = req.user ?? req.session?.user ?? null;
    return this.log({ module, action, targetId, targetName, detail, user });
  }
}