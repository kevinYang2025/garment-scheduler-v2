import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      // Phase 9.5:vite dev 默认代理到 NestJS 3002(大部分已迁)
      // Express 3001 的模块通过 backend-routing.js 决定(默认 warehouse/asn/dn)
      // 这里用代理路由器,migration-status 单独走 NestJS(让前端能拉到)
      '/api/system/migration-status': 'http://localhost:3002',
      '/api/auth': 'http://localhost:3002',
      '/api/system': 'http://localhost:3002',
      '/api/styles': 'http://localhost:3002',
      '/api/main-plan': 'http://localhost:3002',
      '/api/schedule': 'http://localhost:3002',
      '/api/report': 'http://localhost:3002',
      '/api/actual': 'http://localhost:3002',
      // Phase 11:warehouse 解冻 Scope Freeze,默认走 NestJS
      '/api/warehouse': 'http://localhost:3002',
      // asn / dn 仍未迁
      '/api/asn': 'http://localhost:3001',
      '/api/dn': 'http://localhost:3001',
      // Phase 11:Socket.IO 也走 NestJS(Express 接了 Redis Adapter,双向互通)
      '/socket.io': {
        target: 'http://localhost:3002',
        ws: true,
      },
    },
  },
})