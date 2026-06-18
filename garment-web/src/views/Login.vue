<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <div class="logo">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
        </div>
        <h1 class="title">EUC 排程系统</h1>
        <p class="subtitle">柬埔寨制衣工厂生产计划平台</p>
      </div>

      <el-tabs v-model="activeTab" class="login-tabs" stretch>
        <!-- Tab 1: 账号密码 -->
        <el-tab-pane label="账号密码" name="account">
          <el-form @submit.prevent="onAccountLogin" label-position="top">
            <el-form-item label="账号">
              <el-input
                v-model="form.username"
                placeholder="请输入账号"
                size="large"
                autocomplete="username"
                autofocus
              />
            </el-form-item>
            <el-form-item label="密码">
              <el-input
                v-model="form.password"
                type="password"
                placeholder="请输入密码"
                size="large"
                show-password
                autocomplete="current-password"
                @keyup.enter="onAccountLogin"
              />
            </el-form-item>
            <el-button
              type="primary"
              size="large"
              :loading="auth.loading"
              @click="onAccountLogin"
              class="login-btn"
            >登录</el-button>
          </el-form>
        </el-tab-pane>

        <!-- Tab 2: 工号 + PIN(报工员) -->
        <el-tab-pane label="工号 + PIN" name="pin">
          <el-form @submit.prevent="onPinLogin" label-position="top">
            <el-form-item label="工号">
              <el-input
                v-model="form.pin_no"
                placeholder="如 101 / 201"
                size="large"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="5"
                autofocus
              />
            </el-form-item>
            <el-form-item label="4 位 PIN">
              <el-input
                v-model="form.pin"
                type="password"
                placeholder="****"
                size="large"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="4"
                show-password
                @keyup.enter="onPinLogin"
              />
            </el-form-item>
            <el-button
              type="primary"
              size="large"
              :loading="auth.loading"
              @click="onPinLogin"
              class="login-btn"
            >登录</el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <div v-if="errorMsg" class="login-error">{{ errorMsg }}</div>

      <div class="login-tips">
        <p>默认账号:<code>admin</code> / <code>admin123</code></p>
        <p>报工员工号 + PIN 由系统管理员分配</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const activeTab = ref('account')
const errorMsg = ref('')
const form = reactive({
  username: '',
  password: '',
  pin_no: '',
  pin: '',
})

async function onAccountLogin() {
  errorMsg.value = ''
  if (!form.username || !form.password) {
    errorMsg.value = '请输入账号和密码'
    return
  }
  const r = await auth.login({ username: form.username, password: form.password })
  if (r.ok) {
    router.replace('/')
  } else {
    errorMsg.value = r.error
  }
}

async function onPinLogin() {
  errorMsg.value = ''
  if (!form.pin_no || !form.pin) {
    errorMsg.value = '请输入工号和 PIN'
    return
  }
  if (!/^\d{4}$/.test(form.pin)) {
    errorMsg.value = 'PIN 必须是 4 位数字'
    return
  }
  const r = await auth.login({ pin_no: form.pin_no, pin: form.pin })
  if (r.ok) {
    router.replace('/')
  } else {
    errorMsg.value = r.error
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #6e3ff3 0%, #aa8ef9 100%);
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  padding: 40px 32px 32px;
}

.login-header {
  text-align: center;
  margin-bottom: 28px;
}

.logo {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #6e3ff3, #aa8ef9);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}

.title {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4px;
  letter-spacing: -0.3px;
}

.subtitle {
  font-size: 12px;
  color: #6b7280;
  margin: 0;
}

.login-tabs {
  margin-bottom: 8px;
}

.login-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.login-btn {
  width: 100%;
  margin-top: 8px;
}

.login-error {
  background: #fef2f2;
  color: #ef4444;
  border: 1px solid #ef4444;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  margin-top: 12px;
  text-align: center;
}

.login-tips {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed #e5e7eb;
  font-size: 11px;
  color: #6b7280;
  line-height: 1.7;
  text-align: center;
}

.login-tips code {
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: #6e3ff3;
}
</style>
