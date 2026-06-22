import Redis from 'ioredis';
import { Module, Global, Provider, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Phase 1.4 — Redis service(全局单例)
 *
 * Phase 1 用于:
 *   1. Session store(connect-redis)
 *   2. Socket.IO adapter(@socket.io/redis-adapter pub/sub)
 *
 * 必须先起 redis:7-alpine(docker-compose.yml 已配)
 */

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const url = config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    const client = new Redis(url, {
      // 失败重试,避免启动时 redis 还没起就崩
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
    });

    client.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[redis] error:', err.message);
    });
    client.on('connect', () => {
      // eslint-disable-next-line no-console
      console.log('[redis] connected:', url);
    });

    return client;
  },
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy() {
    await this.client.quit();
  }
}