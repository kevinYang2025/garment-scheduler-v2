import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './style.css'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import { initBackendRouting } from '@/config/backend-routing'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// [2026-06-20 fix#前端-P2-7] Vue 全局错误处理
// 统一捕获组件渲染错误,记录到 console + ElMessage,避免白屏
app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue error]', info, err)
  try {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error(`界面错误：${err?.message || err}`)
    })
  } catch { /* ignore */ }
}

// Phase 9.1:异步初始化后端路由(降级逻辑保证不会阻塞首屏,见 §6.3.1)
initBackendRouting().finally(() => {
  app.mount('#app')
})
