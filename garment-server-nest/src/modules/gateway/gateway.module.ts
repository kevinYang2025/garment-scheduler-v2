import { Global, Module } from '@nestjs/common';
import { AppGateway } from './socket.gateway';
import { OnlineUsersService } from './online-users.service';

/**
 * Phase 8 — GatewayModule
 *
 * 装配:
 *   - AppGateway:WebSocketGateway(Phase 1 接入 Redis Adapter,Phase 8 接入业务事件)
 *   - OnlineUsersService:在线用户追踪(Phase 8 新增)
 *
 * 标记 @Global():Phase 8 后的业务 service(controller)可直接注入
 *   不必每个 module 都 import GatewayModule
 */

@Global()
@Module({
  providers: [AppGateway, OnlineUsersService],
  exports: [AppGateway, OnlineUsersService],
})
export class GatewayModule {}