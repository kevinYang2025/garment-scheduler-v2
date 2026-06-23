import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Style } from '../../entity/style.entity';
import { CreateStyleDto, UpdateStyleDto } from './style.dto';
import { OperationLoggerService } from '../../common/logger/operation-logger.service';
import { SessionUser } from '../../common/auth/auth.guard';

/**
 * Phase 4 — StyleService
 *
 * 与 garment-server/server.js /api/styles 完全一致:
 *   - create(): INSERT,记录 style_no + 写操作日志
 *   - update(): UPDATE 走 id(URL),不允许 body.id 覆盖
 *   - delete(): DELETE + 检查存在
 *   - findAll/list/findById
 *
 * 字段对齐:CreateStyleDto → Style entity 字段名映射
 *   - DTO 用 snake_case(与前端/Express 兼容)
 *   - entity 用 camelCase(TypeORM 习惯)
 *   - 转换在 service 里显式做,避免依赖全局 NamingStrategy
 */

@Injectable()
export class StyleService {
  private readonly logger = new Logger('StyleService');

  constructor(
    @InjectRepository(Style) private readonly repo: Repository<Style>,
    private readonly opLog: OperationLoggerService,
  ) {}

  /**
   * 列表 + 简单过滤
   * 支持按 style_no / product_name 模糊搜索
   */
  async findAll(opts: { q?: string } = {}): Promise<Style[]> {
    const q = (opts.q ?? '').trim();
    if (!q) {
      return this.repo.find({ order: { id: 'DESC' }, take: 500 });
    }
    // 用 TypeORM Like(自动 snake_case 转换,经 SnakeCaseNamingStrategy)
    return this.repo.find({
      where: [
        { styleNo: Like(`%${q}%`) },
        { productName: Like(`%${q}%`) },
      ],
      order: { id: 'DESC' },
      take: 500,
    });
  }

  async findById(id: number): Promise<Style> {
    const style = await this.repo.findOne({ where: { id } });
    if (!style) {
      throw new NotFoundException({ message: 'error.404.style.not_found' });
    }
    return style;
  }

  async create(dto: CreateStyleDto, user: SessionUser | null): Promise<Style> {
    const entity = this.repo.create(this.dtoToEntity(dto));
    const saved = await this.repo.save(entity);
    await this.opLog.log({
      module: 'styles',
      action: 'create',
      targetId: saved.id,
      targetName: saved.styleNo,
      detail: '',
      user,
    });
    this.logger.log(`create style id=${saved.id} style_no=${saved.styleNo}`);
    return saved;
  }

  async update(id: number, dto: UpdateStyleDto, user: SessionUser | null): Promise<Style> {
    const existing = await this.findById(id);
    Object.assign(existing, this.dtoToEntity(dto));
    const saved = await this.repo.save(existing);
    await this.opLog.log({
      module: 'styles',
      action: 'update',
      targetId: saved.id,
      targetName: saved.styleNo,
      detail: '',
      user,
    });
    this.logger.log(`update style id=${id}`);
    return saved;
  }

  async remove(id: number, user: SessionUser | null): Promise<void> {
    const existing = await this.findById(id);
    await this.repo.delete(id);
    await this.opLog.log({
      module: 'styles',
      action: 'delete',
      targetId: id,
      targetName: existing.styleNo,
      detail: '',
      user,
    });
    this.logger.log(`delete style id=${id}`);
  }

  /**
   * DTO(snake_case) → Entity(camelCase) 映射
   * 显式列出所有字段避免拼写错误
   */
  private dtoToEntity(dto: CreateStyleDto | UpdateStyleDto): Partial<Style> {
    return {
      styleNo: dto.style_no,
      productName: dto.product_name ?? '',
      styleCategory: dto.style_category ?? '',
      fabricCode: dto.fabric_code ?? '',
      planQty: dto.plan_qty ?? 0,
      dueDate: dto.due_date ?? null,
      orderDate: dto.order_date ?? '',
      embroidery: dto.embroidery ?? '',
      embroideryDailyOutput: dto.embroidery_daily_output ?? 0,
      printing: dto.printing ?? '',
      printingDailyOutput: dto.printing_daily_output ?? 0,
      ironingLabel: dto.ironing_label ?? '',
      ironingDailyOutput: dto.ironing_daily_output ?? 0,
      template: dto.template ?? '',
      templateDailyOutput: dto.template_daily_output ?? 0,
      ttTime: dto.tt_time ?? '',
      targetDailyOutput: dto.target_daily_output ?? 0,
      hasSpecialWash: dto.has_special_wash ?? 0,
      remarks: dto.remarks ?? '',
    };
  }
}