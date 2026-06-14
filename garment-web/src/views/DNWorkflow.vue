<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const props = defineProps({ warehouseType: String })
const emit = defineEmits(['back'])

const dnList = ref([])
const loading = ref(true)
const selectedDn = ref(null)
const showCreateDialog = ref(false)
const details = ref([])

const statusFlow = {
  PENDING: { label: '待拣货', color: 'info', next: ['PICKING', 'CANCELLED'] },
  PICKING: { label: '拣货中', color: 'warning', next: ['PICKED'] },
  PICKED: { label: '已拣货', color: '', next: ['SHIPPED'] },
  SHIPPED: { label: '已发货', color: 'primary', next: ['DELIVERED'] },
  DELIVERED: { label: '已签收', color: 'success', next: [] },
  CANCELLED: { label: '已取消', color: 'danger', next: [] },
}

const createForm = ref({ customer: '', ship_date: '', remark: '' })
const detailForm = ref({ style_no: '', color: '', size_spec: '', plan_qty: 0, unit: '件' })

const warehouseNames = { raw_material: '面料库', auxiliary: '辅料库', cutting_piece: '裁片库', finished: '成品库' }

async function loadDn() {
  loading.value = true
  try {
    const { data } = await api.getDnList({ warehouse_type: props.warehouseType })
    dnList.value = data || []
  } catch { ElMessage.error('加载失败') }
  loading.value = false
}

async function viewDn(id) {
  try {
    const { data } = await api.getDnDetail(id)
    selectedDn.value = data
  } catch { ElMessage.error('加载详情失败') }
}

async function createDn() {
  try {
    const { data } = await api.createDn({
      warehouse_type: props.warehouseType,
      customer: createForm.value.customer,
      ship_date: createForm.value.ship_date,
      remark: createForm.value.remark,
      details: details.value,
    })
    ElMessage.success(`创建成功：${data.dn_code}`)
    showCreateDialog.value = false
    details.value = []
    await loadDn()
  } catch { ElMessage.error('创建失败') }
}

function addDetail() {
  details.value.push({ ...detailForm.value })
  detailForm.value = { style_no: '', color: '', size_spec: '', plan_qty: 0, unit: '件' }
}

function removeDetail(idx) { details.value.splice(idx, 1) }

async function advanceStatus(dn) {
  const next = statusFlow[dn.status]?.next
  if (!next || next.length === 0) return
  const targetStatus = next[0]
  try {
    await ElMessageBox.confirm(`确认将状态从「${statusFlow[dn.status].label}」变为「${statusFlow[targetStatus].label}」？`)
    await api.updateDnStatus(dn.id, { status: targetStatus })
    ElMessage.success('状态更新成功')
    await loadDn()
    if (selectedDn.value?.id === dn.id) await viewDn(dn.id)
  } catch {}
}

async function deleteDn(id) {
  try {
    await ElMessageBox.confirm('确定删除？')
    await api.deleteDn(id)
    selectedDn.value = null
    await loadDn()
  } catch {}
}

onMounted(loadDn)
</script>

<template>
  <div class="dn-page">
    <div class="page-header-bar">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="back-btn" @click="emit('back')">← 返回</button>
        <h2 class="page-heading">📤 出库管理 — {{ warehouseNames[warehouseType] || warehouseType }}</h2>
      </div>
      <el-button type="primary" @click="showCreateDialog = true">新建发货通知</el-button>
    </div>

    <!-- DN 列表 -->
    <el-table :data="dnList" v-loading="loading" stripe size="small" highlight-current-row @current-change="row => viewDn(row?.id)">
      <el-table-column prop="dn_code" label="DN 单号" width="150" />
      <el-table-column prop="customer" label="客户" width="120" />
      <el-table-column prop="ship_date" label="要求发货" width="110" />
      <el-table-column prop="total_qty" label="计划数量" width="90" align="right" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusFlow[row.status]?.color" size="small">{{ statusFlow[row.status]?.label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button v-if="statusFlow[row.status]?.next.length > 0" size="small" text type="primary" @click.stop="advanceStatus(row)">
            → {{ statusFlow[statusFlow[row.status].next[0]]?.label }}
          </el-button>
          <el-button v-if="row.status === 'PENDING'" size="small" text type="danger" @click.stop="deleteDn(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- DN 详情 -->
    <div v-if="selectedDn" class="dn-detail">
      <h3>DN 详情 — {{ selectedDn.dn_code }}</h3>
      <div class="detail-info">
        <span>客户：{{ selectedDn.customer || '-' }}</span>
        <span>要求发货：{{ selectedDn.ship_date || '-' }}</span>
        <span>总数量：{{ selectedDn.total_qty }}</span>
        <span>已发货：{{ selectedDn.shipped_qty }}</span>
      </div>
      <el-table :data="selectedDn.details" size="small" border style="margin-top:12px">
        <el-table-column prop="style_no" label="款号" width="120" />
        <el-table-column prop="color" label="颜色" width="80" />
        <el-table-column prop="size_spec" label="规格" width="80" />
        <el-table-column prop="plan_qty" label="计划数量" width="90" align="right" />
        <el-table-column prop="picked_qty" label="已拣" width="70" align="right" />
        <el-table-column prop="shipped_qty" label="已发" width="70" align="right" />
      </el-table>
    </div>

    <!-- 新建 DN 对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建发货通知单" width="600px" top="5vh">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="客户"><el-input v-model="createForm.customer" /></el-form-item>
        <el-form-item label="要求发货"><el-input v-model="createForm.ship_date" type="date" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="createForm.remark" /></el-form-item>
      </el-form>

      <h4 style="margin:12px 0 8px">发货明细</h4>
      <el-table :data="details" size="small" border max-height="200">
        <el-table-column prop="style_no" label="款号" width="120" />
        <el-table-column prop="color" label="颜色" width="80" />
        <el-table-column prop="size_spec" label="规格" width="80" />
        <el-table-column prop="plan_qty" label="数量" width="80" />
        <el-table-column label="操作" width="60">
          <template #default="{ $index }">
            <el-button size="small" text type="danger" @click="removeDetail($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:end">
        <el-input v-model="detailForm.style_no" placeholder="款号" style="width:120px" />
        <el-input v-model="detailForm.color" placeholder="颜色" style="width:80px" />
        <el-input v-model="detailForm.size_spec" placeholder="规格" style="width:80px" />
        <el-input-number v-model="detailForm.plan_qty" :min="0" style="width:90px" />
        <el-button @click="addDetail" type="primary" text>+ 添加</el-button>
      </div>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="createDn" :disabled="details.length === 0">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.dn-page { max-width: 1100px; }
.page-header-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-heading { font-size: 18px; font-weight: 700; }
.back-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px; }
.back-btn:hover { color: var(--primary); }

.dn-detail {
  margin-top: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.dn-detail h3 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.detail-info { display: flex; gap: 20px; font-size: 13px; color: var(--text-secondary); }
</style>
