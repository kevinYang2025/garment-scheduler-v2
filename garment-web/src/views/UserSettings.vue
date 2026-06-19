<template>
  <div class="user-settings-page">
    <div class="page-header-bar">
      <h2 class="page-heading">个人设置</h2>
    </div>

    <div class="settings-card">
      <!-- 头像区域 -->
      <div class="avatar-section">
        <div class="avatar-wrap" @click="showAvatarDialog = true">
          <div class="avatar" :style="avatarStyle">
            <img v-if="form.avatar_url" :src="form.avatar_url" class="avatar-img" />
            <span v-else>{{ avatarLetter }}</span>
          </div>
          <div class="avatar-badge">📷</div>
        </div>
        <div class="avatar-info">
          <div class="avatar-name">{{ auth.user?.display_name || '未设置' }}</div>
          <div class="avatar-role">{{ roleLabel }}</div>
          <div class="avatar-hint">点击更换头像</div>
        </div>
      </div>

      <!-- 基本信息 -->
      <el-divider />
      <h3 class="section-title">基本信息</h3>
      <el-form :model="form" label-width="80px" class="settings-form">
        <el-form-item label="账号">
          <el-input :value="auth.user?.username" disabled />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="form.display_name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="车间" v-if="auth.user?.workshop">
          <el-input :value="workshopLabel" disabled />
        </el-form-item>
        <el-form-item label="角色">
          <el-input :value="roleLabel" disabled />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveProfile" :loading="saving">保存信息</el-button>
        </el-form-item>
      </el-form>

      <!-- 修改密码 -->
      <el-divider />
      <h3 class="section-title">修改密码</h3>
      <el-form :model="pwdForm" label-width="80px" class="settings-form">
        <el-form-item label="旧密码">
          <el-input v-model="pwdForm.old_password" type="password" show-password placeholder="请输入旧密码" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.new_password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="pwdForm.confirm_password" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
        <el-form-item>
          <el-button type="warning" @click="changePassword" :loading="changingPwd">修改密码</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 头像选择弹窗 -->
    <el-dialog v-model="showAvatarDialog" title="更换头像" width="500px" destroy-on-close>
      <div class="avatar-options">
        <h4 class="avatar-section-title">选择默认头像</h4>
        <div class="default-avatars">
          <div
            v-for="(av, i) in defaultAvatars"
            :key="i"
            class="default-avatar-item"
            :class="{ selected: selectedDefault === i }"
            @click="selectDefault(i)"
          >
            <div class="default-avatar">
              <span>{{ av.emoji }}</span>
            </div>
          </div>
        </div>

        <el-divider />

        <h4 class="avatar-section-title">上传自定义头像</h4>
        <div class="upload-area">
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            style="display: none"
            @change="handleFileSelect"
          />
          <el-button @click="$refs.fileInput.click()">选择图片</el-button>
          <span class="upload-hint">支持 JPG/PNG，自动裁剪压缩</span>
        </div>

        <!-- 裁剪预览 -->
        <div v-if="cropSrc" class="crop-preview">
          <div class="crop-canvas-wrap">
            <canvas ref="cropCanvas" width="200" height="200" class="crop-canvas"></canvas>
          </div>
          <div class="crop-actions">
            <el-button size="small" @click="cropSrc = null">取消</el-button>
            <el-button size="small" type="primary" @click="applyCrop">使用此图</el-button>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="showAvatarDialog = false">取消</el-button>
        <el-button type="primary" @click="saveAvatar">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import api from '../api'

const auth = useAuthStore()
const saving = ref(false)
const changingPwd = ref(false)
const showAvatarDialog = ref(false)
const fileInput = ref(null)
const cropCanvas = ref(null)
const cropSrc = ref(null)
const selectedDefault = ref(-1)
const pendingAvatarUrl = ref('')

const form = ref({
  display_name: '',
  avatar_url: '',
})

const pwdForm = ref({
  old_password: '',
  new_password: '',
  confirm_password: '',
})

const defaultAvatars = [
  { emoji: '👨‍💼', bg: 'linear-gradient(135deg, #6e3ff3, #8b5cf6)' },
  { emoji: '👩‍💼', bg: 'linear-gradient(135deg, #ec4899, #f472b6)' },
  { emoji: '👷', bg: 'linear-gradient(135deg, #f59e0b, #fbbf24)' },
  { emoji: '👨‍🔧', bg: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
  { emoji: '👩‍🏭', bg: 'linear-gradient(135deg, #22c55e, #4ade80)' },
  { emoji: '🧑‍💻', bg: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
  { emoji: '👤', bg: 'linear-gradient(135deg, #64748b, #94a3b8)' },
  { emoji: '👥', bg: 'linear-gradient(135deg, #14b8a6, #2dd4bf)' },
  { emoji: '🏭', bg: 'linear-gradient(135deg, #ef4444, #f87171)' },
  { emoji: '⚙️', bg: 'linear-gradient(135deg, #6366f1, #818cf8)' },
  { emoji: '🎯', bg: 'linear-gradient(135deg, #f97316, #fb923c)' },
  { emoji: '⭐', bg: 'linear-gradient(135deg, #eab308, #facc15)' },
]

const roleMap = {
  admin: '系统管理员',
  planning_manager: '计划主管',
  planner: '计划员',
  dispatcher: '报工员',
  supervisor: '车间主任',
}
const roleLabel = computed(() => roleMap[auth.user?.role] || '用户')

const workshopMap = {
  cutting: '裁剪', printing: '印花', embroidery: '刺绣',
  template: '模板', ironing: '烫标', sewing: '缝制',
}
const workshopLabel = computed(() => workshopMap[auth.user?.workshop] || auth.user?.workshop || '')

const avatarLetter = computed(() => {
  const name = auth.user?.display_name || ''
  return name.charAt(0) || 'U'
})

const avatarStyle = computed(() => {
  if (form.value.avatar_url) return {}
  return { background: 'linear-gradient(135deg, #6e3ff3, #8b5cf6)' }
})

function selectDefault(i) {
  selectedDefault.value = i
  cropSrc.value = null
  // 生成默认头像的 data URL
  const av = defaultAvatars[i]
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  // 绘制渐变背景
  const grad = ctx.createLinearGradient(0, 0, 128, 128)
  const colors = av.bg.match(/#[a-f0-9]+/gi) || ['#6e3ff3', '#8b5cf6']
  grad.addColorStop(0, colors[0])
  grad.addColorStop(1, colors[1] || colors[0])
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(64, 64, 64, 0, Math.PI * 2)
  ctx.fill()
  // 绘制 emoji
  ctx.font = '56px serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(av.emoji, 64, 68)
  pendingAvatarUrl.value = canvas.toDataURL('image/png', 0.8)
}

function handleFileSelect(e) {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('图片不能超过 5MB')
    return
  }
  selectedDefault.value = -1
  const reader = new FileReader()
  reader.onload = (ev) => {
    cropSrc.value = ev.target.result
    nextTick(() => drawCropPreview())
  }
  reader.readAsDataURL(file)
  e.target.value = ''
}

function drawCropPreview() {
  if (!cropSrc.value || !cropCanvas.value) return
  const canvas = cropCanvas.value
  const ctx = canvas.getContext('2d')
  const img = new Image()
  img.onload = () => {
    // 居中裁剪为正方形
    const size = Math.min(img.width, img.height)
    const sx = (img.width - size) / 2
    const sy = (img.height - size) / 2
    ctx.clearRect(0, 0, 200, 200)
    ctx.drawImage(img, sx, sy, size, size, 0, 0, 200, 200)
  }
  img.src = cropSrc.value
}

function applyCrop() {
  if (!cropCanvas.value) return
  // 压缩到 128x128
  const tmpCanvas = document.createElement('canvas')
  tmpCanvas.width = 128
  tmpCanvas.height = 128
  const ctx = tmpCanvas.getContext('2d')
  ctx.drawImage(cropCanvas.value, 0, 0, 128, 128)
  pendingAvatarUrl.value = tmpCanvas.toDataURL('image/jpeg', 0.7)
  cropSrc.value = null
  ElMessage.success('头像已裁剪')
}

async function saveAvatar() {
  if (!pendingAvatarUrl.value) {
    showAvatarDialog.value = false
    return
  }
  try {
    await api.put(`/users/${auth.user.id}`, { avatar_url: pendingAvatarUrl.value })
    form.value.avatar_url = pendingAvatarUrl.value
    auth.user.avatar_url = pendingAvatarUrl.value
    ElMessage.success('头像已更新')
    showAvatarDialog.value = false
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '保存失败')
  }
}

async function saveProfile() {
  if (!form.value.display_name) {
    ElMessage.error('请输入姓名')
    return
  }
  saving.value = true
  try {
    await api.put(`/users/${auth.user.id}`, { display_name: form.value.display_name })
    auth.user.display_name = form.value.display_name
    ElMessage.success('保存成功')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '保存失败')
  }
  saving.value = false
}

async function changePassword() {
  if (!pwdForm.value.old_password || !pwdForm.value.new_password) {
    ElMessage.error('请填写旧密码和新密码')
    return
  }
  if (pwdForm.value.new_password.length < 6) {
    ElMessage.error('新密码至少 6 位')
    return
  }
  if (pwdForm.value.new_password !== pwdForm.value.confirm_password) {
    ElMessage.error('两次输入的密码不一致')
    return
  }
  changingPwd.value = true
  try {
    await auth.changePassword(pwdForm.value.old_password, pwdForm.value.new_password)
    ElMessage.success('密码修改成功')
    pwdForm.value = { old_password: '', new_password: '', confirm_password: '' }
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '修改失败')
  }
  changingPwd.value = false
}

onMounted(() => {
  form.value.display_name = auth.user?.display_name || ''
  form.value.avatar_url = auth.user?.avatar_url || ''
})
</script>

<style scoped>
.user-settings-page {
  max-width: 600px;
  padding: 24px;
}
.page-header-bar { margin-bottom: 24px; }
.page-heading { font-size: 20px; font-weight: 700; }

.settings-card {
  background: var(--card, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: var(--radius, 8px);
  padding: 24px;
}

.avatar-section {
  display: flex;
  align-items: center;
  gap: 16px;
}
.avatar-wrap {
  position: relative;
  cursor: pointer;
}
.avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6e3ff3, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 28px;
  font-weight: 700;
  overflow: hidden;
}
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-badge {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 24px;
  height: 24px;
  background: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  box-shadow: 0 2px 4px rgba(0,0,0,.1);
}
.avatar-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.avatar-name { font-size: 20px; font-weight: 700; color: #111827; }
.avatar-role { font-size: 14px; color: #6b7280; }
.avatar-hint { font-size: 12px; color: #9ca3af; }

.section-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
.settings-form { max-width: 400px; }

/* 头像选择弹窗 */
.avatar-section-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: #374151; }
.default-avatars {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}
.default-avatar-item {
  cursor: pointer;
  padding: 4px;
  border-radius: 12px;
  border: 2px solid transparent;
  transition: all .15s;
}
.default-avatar-item:hover { border-color: #c4b5fd; }
.default-avatar-item.selected { border-color: #6e3ff3; background: #f3f0ff; }
.default-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}

.upload-area {
  display: flex;
  align-items: center;
  gap: 12px;
}
.upload-hint { font-size: 12px; color: #9ca3af; }

.crop-preview {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.crop-canvas-wrap {
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}
.crop-canvas {
  display: block;
  border-radius: 50%;
}
.crop-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
