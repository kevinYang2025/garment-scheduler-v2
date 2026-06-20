<template>
  <div class="user-mgmt-page">
    <!-- 页面标题 -->
    <div class="page-header-bar">
      <h2 class="page-heading" style="white-space:pre-line">{{ t('user.title', 'zh') }}</h2>
      <el-button type="primary" @click="openAdd" :icon="Plus"><span style="white-space:pre-line">{{ t('user.addBtn', 'zh') }}</span></el-button>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <el-select v-model="filterRole" :placeholder="t('user.filterRole', 'zh')" clearable style="width: 150px">
        <el-option :label="t('user.role.admin', 'zh')" value="admin" />
        <el-option :label="t('user.role.planning_manager', 'zh')" value="planning_manager" />
        <el-option :label="t('user.role.planner', 'zh')" value="planner" />
        <el-option :label="t('user.role.dispatcher', 'zh')" value="dispatcher" />
        <el-option :label="t('user.role.supervisor', 'zh')" value="supervisor" />
      </el-select>
      <el-select v-model="filterWorkshop" :placeholder="t('user.filterWorkshop', 'zh')" clearable style="width: 150px">
        <el-option :label="t('user.workshop.cutting', 'zh')" value="cutting" />
        <el-option :label="t('user.workshop.printing', 'zh')" value="printing" />
        <el-option :label="t('user.workshop.embroidery', 'zh')" value="embroidery" />
        <el-option :label="t('user.workshop.template', 'zh')" value="template" />
        <el-option :label="t('user.workshop.ironing', 'zh')" value="ironing" />
        <el-option :label="t('user.workshop.sewing', 'zh')" value="sewing" />
      </el-select>
      <el-input v-model="filterName" :placeholder="t('user.searchPh', 'zh')" clearable style="width: 200px" :prefix-icon="Search" />
    </div>

    <!-- 用户表格 -->
    <el-table :data="filteredUsers" border stripe style="width: 100%" v-loading="loading">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column :label="t('user.username', 'zh')" width="140">
        <template #default="{ row }">
          <div style="white-space:pre-line;line-height:1.3">{{ row.username || '-' }}{{ row.username_km ? '\n' + row.username_km : '' }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="t('user.full_name', 'zh')" min-width="120">
        <template #default="{ row }">
          <div style="white-space:pre-line;line-height:1.3">{{ row.display_name || '-' }}{{ row.display_name_km ? '\n' + row.display_name_km : '' }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="t('user.role', 'zh')" width="130">
        <template #default="{ row }">
          <el-tag :type="roleTagType(row.role)" size="small"><span style="white-space:pre-line">{{ roleLabel(row.role) }}</span></el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('user.workshop', 'zh')" width="100">
        <template #default="{ row }">
          <span style="white-space:pre-line">{{ row.workshop ? workshopLabel(row.workshop) : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('user.status', 'zh')" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.active ? 'success' : 'info'" size="small">
            <span style="white-space:pre-line">{{ row.active ? t('user.active', 'zh') : t('user.inactive', 'zh') }}</span>
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" :label="t('user.createdAt', 'zh')" width="160" />
      <el-table-column :label="t('user.cols.action', 'zh')" min-width="260" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)"><span style="white-space:pre-line">{{ t('common.edit', 'zh') }}</span></el-button>
          <el-button size="small" type="warning" @click="openResetPwd(row)"><span style="white-space:pre-line">{{ t('user.resetPwd', 'zh') }}</span></el-button>
          <el-button v-if="row.role === 'dispatcher'" size="small" type="warning" @click="openResetPin(row)"><span style="white-space:pre-line">{{ t('user.resetPin', 'zh') }}</span></el-button>
          <el-button size="small" :type="row.active ? 'danger' : 'success'" @click="toggleActive(row)">
            <span style="white-space:pre-line">{{ row.active ? t('user.inactive', 'zh') : t('user.active', 'zh') }}</span>
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" width="520px" destroy-on-close>
      <template #title><span style="white-space:pre-line">{{ isEdit ? t('user.editTitle', 'zh') : t('user.addTitle', 'zh') }}</span></template>
      <el-form :model="form" label-width="100px" :rules="formRules" ref="formRef">
        <el-form-item :label="t('user.username', 'zh')" prop="username">
          <el-input v-model="form.username" :disabled="isEdit" :placeholder="t('user.usernamePh', 'zh')" />
        </el-form-item>
        <el-form-item :label="t('user.username_km', 'zh')">
          <el-input v-model="form.username_km" :placeholder="t('user.username_kmPh', 'zh')" />
        </el-form-item>
        <el-form-item :label="t('user.full_name', 'zh')" prop="display_name">
          <el-input v-model="form.display_name" :placeholder="t('user.displayNamePh', 'zh')" />
        </el-form-item>
        <el-form-item :label="t('user.display_name_km', 'zh')">
          <el-input v-model="form.display_name_km" :placeholder="t('user.displayNameKmPh', 'zh')" />
        </el-form-item>
        <el-form-item :label="t('user.role', 'zh')" prop="role">
          <el-select v-model="form.role" style="width: 100%">
            <el-option :label="t('user.role.admin', 'zh')" value="admin" />
            <el-option :label="t('user.role.planning_manager', 'zh')" value="planning_manager" />
            <el-option :label="t('user.role.planner', 'zh')" value="planner" />
            <el-option :label="t('user.role.dispatcher', 'zh')" value="dispatcher" />
            <el-option :label="t('user.role.supervisor', 'zh')" value="supervisor" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('user.workshop', 'zh')" prop="workshop" v-if="needsWorkshop">
          <el-select v-model="form.workshop" style="width: 100%" :placeholder="t('user.workshopPh', 'zh')">
            <el-option :label="t('user.workshop.cutting', 'zh')" value="cutting" />
            <el-option :label="t('user.workshop.printing', 'zh')" value="printing" />
            <el-option :label="t('user.workshop.embroidery', 'zh')" value="embroidery" />
            <el-option :label="t('user.workshop.template', 'zh')" value="template" />
            <el-option :label="t('user.workshop.ironing', 'zh')" value="ironing" />
            <el-option :label="t('user.workshop.sewing', 'zh')" value="sewing" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('user.password', 'zh')" prop="password" v-if="form.role !== 'dispatcher'">
          <el-input v-model="form.password" type="password" show-password :placeholder="isEdit ? t('user.passwordKeep', 'zh') : t('user.passwordNew', 'zh')" />
        </el-form-item>
        <el-form-item :label="t('user.pin', 'zh')" prop="pin" v-if="form.role === 'dispatcher'">
          <el-input v-model="form.pin" maxlength="4" :placeholder="isEdit ? t('user.passwordKeep', 'zh') : t('user.pinNew', 'zh')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false"><span style="white-space:pre-line">{{ t('common.cancel', 'zh') }}</span></el-button>
        <el-button type="primary" :loading="saving" @click="submitForm"><span style="white-space:pre-line">{{ t('common.confirm', 'zh') }}</span></el-button>
      </template>
    </el-dialog>

    <!-- 重置密码弹窗 -->
    <el-dialog v-model="resetPwdVisible" width="400px" destroy-on-close>
      <template #title><span style="white-space:pre-line">{{ t('user.resetPwd', 'zh') }}</span></template>
      <p style="margin-bottom: 12px;white-space:pre-line">{{ t('user.resetPwdDesc', 'zh', { name: resetTarget?.display_name, user: resetTarget?.username }) }}</p>
      <el-form-item :label="t('user.password', 'zh')">
        <el-input v-model="resetNewPwd" type="password" show-password :placeholder="t('user.passwordNew', 'zh')" />
      </el-form-item>
      <template #footer>
        <el-button @click="resetPwdVisible = false"><span style="white-space:pre-line">{{ t('common.cancel', 'zh') }}</span></el-button>
        <el-button type="primary" :loading="resetting" @click="doResetPwd"><span style="white-space:pre-line">{{ t('common.confirm', 'zh') }}</span></el-button>
      </template>
    </el-dialog>

    <!-- 重置 PIN 弹窗 -->
    <el-dialog v-model="resetPinVisible" width="400px" destroy-on-close>
      <template #title><span style="white-space:pre-line">{{ t('user.resetPin', 'zh') }}</span></template>
      <p style="margin-bottom: 12px;white-space:pre-line">{{ t('user.resetPinDesc', 'zh', { name: resetTarget?.display_name, user: resetTarget?.username }) }}</p>
      <el-form-item :label="t('user.pin', 'zh')">
        <el-input v-model="resetNewPin" maxlength="4" :placeholder="t('user.pinNew', 'zh')" />
      </el-form-item>
      <template #footer>
        <el-button @click="resetPinVisible = false"><span style="white-space:pre-line">{{ t('common.cancel', 'zh') }}</span></el-button>
        <el-button type="primary" :loading="resetting" @click="doResetPin"><span style="white-space:pre-line">{{ t('common.confirm', 'zh') }}</span></el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import api from '../api'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const users = ref([])

// 筛选
const filterRole = ref('')
const filterWorkshop = ref('')
const filterName = ref('')

// 弹窗
const dialogVisible = ref(false)
const isEdit = ref(false)
const editId = ref(null)
const formRef = ref(null)

const resetPwdVisible = ref(false)
const resetPinVisible = ref(false)
const resetTarget = ref(null)
const resetNewPwd = ref('')
const resetNewPin = ref('')

const form = reactive({
  username: '',
  username_km: '',
  display_name: '',
  display_name_km: '',
  role: 'planner',
  workshop: '',
  password: '',
  pin: '',
})

const needsWorkshop = computed(() => ['dispatcher', 'supervisor'].includes(form.role))

const formRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  display_name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

// 角色/车间标签 — i18n
function roleLabel(r) {
  return t(`user.role.${r}`, 'zh')
}
function roleTagType(r) {
  const map = { admin: 'danger', planning_manager: 'warning', planner: '', dispatcher: 'info', supervisor: 'success' }
  return map[r] || ''
}
function workshopLabel(w) {
  return t(`user.workshop.${w}`, 'zh')
}

// 筛选后数据
const filteredUsers = computed(() => {
  return users.value.filter(u => {
    if (filterRole.value && u.role !== filterRole.value) return false
    if (filterWorkshop.value && u.workshop !== filterWorkshop.value) return false
    if (filterName.value) {
      const kw = filterName.value.toLowerCase()
      const hay = `${u.username || ''} ${u.username_km || ''} ${u.display_name || ''} ${u.display_name_km || ''}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
})

// 加载用户列表
async function loadUsers() {
  loading.value = true
  try {
    const params = {}
    if (filterRole.value) params.role = filterRole.value
    if (filterWorkshop.value) params.workshop = filterWorkshop.value
    const res = await api.get('/users', { params })
    users.value = res.data
  } catch (e) {
    ElMessage.error('加载用户列表失败')
  } finally {
    loading.value = false
  }
}

// 打开新增弹窗
function openAdd() {
  isEdit.value = false
  editId.value = null
  Object.assign(form, { username: '', username_km: '', display_name: '', display_name_km: '', role: 'planner', workshop: '', password: '', pin: '' })
  dialogVisible.value = true
}

// 打开编辑弹窗
function openEdit(row) {
  isEdit.value = true
  editId.value = row.id
  Object.assign(form, {
    username: row.username,
    username_km: row.username_km || '',
    display_name: row.display_name,
    display_name_km: row.display_name_km || '',
    role: row.role,
    workshop: row.workshop || '',
    password: '',
    pin: '',
  })
  dialogVisible.value = true
}

// 提交表单
async function submitForm() {
  if (!formRef.value) return
  await formRef.value.validate()

  if (['dispatcher', 'supervisor'].includes(form.role) && !form.workshop) {
    ElMessage.error('dispatcher/supervisor 必须选择车间')
    return
  }
  if (!isEdit.value && form.role !== 'dispatcher' && !form.password) {
    ElMessage.error('非报工员必须设置密码')
    return
  }
  if (!isEdit.value && form.role === 'dispatcher' && !form.pin) {
    ElMessage.error('报工员必须设置 PIN')
    return
  }

  saving.value = true
  try {
    const body = {
      username: form.username,
      username_km: form.username_km || null,
      display_name: form.display_name,
      display_name_km: form.display_name_km || null,
      role: form.role,
      workshop: form.workshop || null,
    }
    if (form.password) body.password = form.password
    if (form.pin) body.pin = form.pin

    if (isEdit.value) {
      await api.put(`/users/${editId.value}`, body)
      ElMessage.success('用户已更新')
    } else {
      await api.post('/users', body)
      ElMessage.success('用户已创建')
    }
    dialogVisible.value = false
    loadUsers()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '操作失败')
  } finally {
    saving.value = false
  }
}

// 切换启用/禁用
async function toggleActive(row) {
  const action = row.active ? '禁用' : '启用'
  try {
    await ElMessageBox.confirm(`确定要${action}用户 ${row.display_name} 吗?`, '提示', { type: 'warning' })
    await api.put(`/users/${row.id}`, { active: !row.active })
    ElMessage.success(`已${action}`)
    loadUsers()
  } catch { /* cancelled */ }
}

// 重置密码
function openResetPwd(row) {
  resetTarget.value = row
  resetNewPwd.value = ''
  resetPwdVisible.value = true
}
async function doResetPwd() {
  if (!resetNewPwd.value || resetNewPwd.value.length < 6) {
    ElMessage.error('密码至少 6 位')
    return
  }
  resetting.value = true
  try {
    await api.post(`/users/${resetTarget.value.id}/reset-password`, { new_password: resetNewPwd.value })
    ElMessage.success('密码已重置')
    resetPwdVisible.value = false
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '重置失败')
  } finally {
    resetting.value = false
  }
}

// 重置 PIN
function openResetPin(row) {
  resetTarget.value = row
  resetNewPin.value = ''
  resetPinVisible.value = true
}
async function doResetPin() {
  if (!/^\d{4}$/.test(resetNewPin.value)) {
    ElMessage.error('PIN 必须是 4 位数字')
    return
  }
  resetting.value = true
  try {
    await api.post(`/users/${resetTarget.value.id}/reset-pin`, { new_pin: resetNewPin.value })
    ElMessage.success('PIN 已重置')
    resetPinVisible.value = false
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '重置失败')
  } finally {
    resetting.value = false
  }
}

onMounted(loadUsers)
</script>

<style scoped>
.user-mgmt-page {
  padding: 24px;
}
.page-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.page-heading {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}
.filter-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
</style>
