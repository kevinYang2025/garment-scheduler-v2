<template>
  <div class="actual-review">
    <div class="page-header-bar">
      <h2 class="page-heading" style="white-space:pre-line">{{ t('actualReview.title') }}</h2>
      <p class="page-desc" style="white-space:pre-line">
        <span v-html="t('actualReview.desc', null, { workshop: workshopNames[scheduleType] || scheduleType || auth.workshop, operator: auth.user?.display_name || '' })"></span>
      </p>
    </div>

    <div class="toolbar">
      <el-select
        v-model="scheduleType"
        :placeholder="t('actualReview.filter.wsPh')"
        style="width: 160px"
        :disabled="auth.role === 'supervisor'"
        @change="load"
      >
        <el-option
          v-for="(name, key) in workshopNames"
          :key="key"
          :label="name"
          :value="key"
        />
      </el-select>
      <el-input v-model="filterStyle" :placeholder="t('actualReview.filter.stylePh')" clearable style="width: 240px" />
      <el-button @click="load" type="primary" :loading="loading"><span style="white-space:pre-line">{{ t('actualReview.btn.refresh') }}</span></el-button>
    </div>

    <el-table :data="filteredRows" v-loading="loading" border style="width: 100%; margin-top: 12px;">
      <el-table-column prop="schedule_date" :label="t('actualReview.cols.date')" width="120" sortable />
      <el-table-column prop="style_no" :label="t('actualReview.cols.styleNo')" min-width="180" />
      <el-table-column prop="color" :label="t('actualReview.cols.color')" width="100" />
      <el-table-column prop="size_spec" :label="t('actualReview.cols.size')" width="100" />
      <el-table-column :label="t('actualReview.cols.actual')" width="160">
        <template #default="{ row }">
          <el-input-number
            v-model="row.qty"
            :min="0"
            size="small"
            :disabled="isLockedByOther(row)"
          />
        </template>
      </el-table-column>
      <el-table-column :label="t('actualReview.cols.lockStatus')" width="160">
        <template #default="{ row }">
          <el-tag v-if="!row.locked_by_user_id" type="info" style="white-space:pre-line">{{ t('actualReview.lock.unlocked') }}</el-tag>
          <el-tag v-else-if="row.locked_by_user_id === auth.user?.id" type="success" style="white-space:pre-line">{{ t('actualReview.lock.mine') }}</el-tag>
          <el-tag v-else type="warning" effect="dark" style="white-space:pre-line">{{ t('actualReview.lock.others') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('actualReview.cols.modRecord')" min-width="200">
        <template #default="{ row }">
          <div v-if="row.locked_by_name" class="mod-info">
            <div class="mod-by" style="white-space:pre-line">{{ t('actualReview.modRecord', null, { name: row.locked_by_name, time: formatLockedAt(row.locked_at) }) }}</div>
          </div>
          <span v-else class="mod-empty">—</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('actualReview.cols.action')" width="200" fixed="right">
        <template #default="{ row }">
          <el-button @click="save(row)" type="primary" size="small" :disabled="isLockedByOther(row)"><span style="white-space:pre-line">{{ t('actualReview.btn.save') }}</span></el-button>
          <el-button
            v-if="row.locked_by_user_id === auth.user?.id"
            @click="unlock(row)"
            size="small"
          ><span style="white-space:pre-line">{{ t('actualReview.btn.unlock') }}</span></el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="!loading && filteredRows.length === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <p style="white-space:pre-line">{{ t('actualReview.empty') }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'
import api from '../api'

const auth = useAuthStore()
const { t } = useI18n()
const rows = ref([])
const loading = ref(false)
const filterStyle = ref('')
const scheduleType = ref(auth.workshop || '')

// 车间名 (从 i18n 字典读, both 模式自动双语)
const workshopNames = computed(() => ({
  cutting: t('actualReview.workshop.cutting'),
  printing: t('actualReview.workshop.printing'),
  embroidery: t('actualReview.workshop.embroidery'),
  template: t('actualReview.workshop.template'),
  ironing: t('actualReview.workshop.ironing'),
  sewing: t('actualReview.workshop.sewing'),
}))

const filteredRows = computed(() => rows.value)  // [段8 M-2] 后端已筛,前端不再 filter

// [段8 M-2] 款号变化触发重载,带 350ms 防抖避免连打字连发
let filterStyleTimer = null
watch(filterStyle, () => {
  clearTimeout(filterStyleTimer)
  filterStyleTimer = setTimeout(() => {
    if (scheduleType.value) load()
  }, 350)
})

function isLockedByOther(row) {
  return row.locked_by_user_id && row.locked_by_user_id !== auth.user?.id
}

function formatLockedAt(v) {
  if (!v) return ''
  // SQLite 格式 'YYYY-MM-DD HH:MM:SS'(localtime)
  return v.replace('T', ' ').slice(0, 16)
}

async function load() {
  if (!scheduleType.value) {
    ElMessage.warning(t('actualReview.toast.chooseWs'))
    rows.value = []
    return
  }
  loading.value = true
  try {
    // [2026-06-20 段8 M-2] 款号筛选走后端 SQL LIKE(替代客户端 .filter)
    const r = await api.get('/schedule/daily/actuals', {
      params: {
        schedule_type: scheduleType.value,
        style_no: filterStyle.value || ''
      }
    })
    rows.value = r.data
    // [2026-06-20 fix#业务-P1-5] 多 tab 锁冲突:记录加载时的 qty,save 时传给后端校验
    for (const r of rows.value) r._originalQty = r.qty
  } catch (e) {
    ElMessage.error(t('actualReview.toast.loadFail', null, { err: e.response?.data?.error || e.message }))
  } finally {
    loading.value = false
  }
}

async function save(row) {
  try {
    // [2026-06-20 fix#业务-P1-5] expected_qty 是加载行时的 qty,如果其他 tab/会话已改则后端 409
    const { data } = await api.put(`/schedule/daily/actual/${row.id}`, {
      qty: row.qty,
      expected_qty: row._originalQty,
    })
    // [2026-06-20 段15 BUG 3] 用后端返回的锁持有者(admin 改不抢锁,保持原锁)
    row.locked_by_user_id = data?.locked_by_user_id ?? auth.user?.id
    row.locked_at = data?.locked_at || new Date().toISOString()
    // 保存成功后 _originalQty 更新为最新值
    row._originalQty = row.qty
    ElMessage.success(t('actualReview.toast.saveOk'))
  } catch (e) {
    if (e.response?.status === 409) {
      // [fix#业务-P1-5] 数据冲突,提示用户并刷新
      ElMessage.warning(t('actualReview.toast.saveConflict', null, { err: e.response?.data?.error || '数据已过期' }))
      await load()
      return
    }
    ElMessage.error(t('actualReview.toast.saveFail', null, { err: e.response?.data?.error || e.message }))
  }
}

async function unlock(row) {
  try {
    await ElMessageBox.confirm(t('actualReview.toast.confirmUnlock'), t('actualReview.toast.confirmTitle'), { type: 'warning' })
    await api.post(`/schedule/daily/actual/${row.id}/unlock`)
    row.locked_by_user_id = null
    row.locked_at = null
    ElMessage.success(t('actualReview.toast.unlockOk'))
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(t('actualReview.toast.unlockFail', null, { err: e.response?.data?.error || e.message }))
  }
}

onMounted(load)
</script>

<style scoped>
.actual-review {
  padding: 4px 0 24px;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.mod-info {
  font-size: 12px;
  line-height: 1.5;
}
.mod-by {
  color: var(--text);
  font-weight: 500;
}
.mod-empty {
  color: var(--text-tertiary);
  font-size: 12px;
}
</style>