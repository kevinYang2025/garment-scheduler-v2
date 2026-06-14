<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const props = defineProps({ warehouseType: String })
const emit = defineEmits(['back'])

const asnList = ref([])
const loading = ref(true)
const selectedAsn = ref(null)
const showCreateDialog = ref(false)
const details = ref([])

const statusFlow = {
  PENDING: { label: '待收货', color: 'info', next: ['RECEIVED', 'CANCELLED'] },
  RECEIVED: { label: '已收货', color: 'warning', next: ['INSPECTING', 'COMPLETED'] },
  INSPECTING: { label: '质检中', color: '', next: ['COMPLETED'] },
  COMPLETED: { label: '已完成', color: 'success', next: [] },
  CANCELLED: { label: '已取消', color: 'danger', next: [] },
}

const createForm = ref({ supplier: '', expected_date: '', remark: '' })
const detailForm = ref({ style_no: '', fabric_name: '', color: '', size_spec: '', pot_no: '', plan_qty: 0, unit: '件' })

const warehouseNames = { raw_material: '面料库', auxiliary: '辅料库', cutting_piece: '裁片库', finished: '成品库' }

async function loadAsn() {
  loading.value = true
  try {
    const { data } = await api.getAsnList({ warehouse_type: props.warehouseType })
    asnList.value = data || []
  } catch { ElMessage.error('加载失败') }
  loading.value = false
}

async function viewAsn(id) {
  try {
    const { data } = await api.getAsnDetail(id)
    selectedAsn.value = data
  } catch { ElMessage.error('加载详情失败') }
}

async function createAsn() {
  try {
    const { data } = await api.createAsn({
      warehouse_type: props.warehouseType,
      supplier: createForm.value.supplier,
      expected_date: createForm.value.expected_date,
      remark: createForm.value.remark,
      details: details.value,
    })
    ElMessage.success(`创建成功：${data.asn_code}`)
    showCreateDialog.value = false
    details.value = []
    await loadAsn()
  } catch { ElMessage.error('创建失败') }
}

function addDetail() {
  details.value.push({ ...detailForm.value })
  detailForm.value = { style_no: '', fabric_name: '', color: '', size_spec: '', pot_no: '', plan_qty: 0, unit: '件' }
}

function removeDetail(idx) {
  details.value.splice(idx, 1)
}

async function advanceStatus(asn) {
  const next = statusFlow[asn.status]?.next
  if (!next || next.length === 0) return
  const targetStatus = next[0]
  try {
    await ElMessageBox.confirm(`确认将状态从「${statusFlow[asn.status].label}」变为「${statusFlow[targetStatus].label}」？`)
    await api.updateAsnStatus(asn.id, { status: targetStatus })
    ElMessage.success('状态更新成功')
    await loadAsn()
    if (selectedAsn.value?.id === asn.id) await viewAsn(asn.id)
  } catch {}
}

async function deleteAsn(id) {
  try {
    await ElMessageBox.confirm('确定删除？')
    await api.deleteAsn(id)
    selectedAsn.value = null
    await loadAsn()
  } catch {}
}

onMounted(loadAsn)
</script>

<template>
  <div class="asn-page">
    <div class="page-header-bar">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="back-btn" @click="emit('back')">← 返回</button>
        <h2 class="page-heading">📦 入库管理 — {{ warehouseNames[warehouseType] || warehouseType }}</h2>
      </div>
      <el-button type="primary" @click="showCreateDialog = true">新建到货通知</el-button>
    </div>

    <!-- ASN 列表 -->
    <el-table :data="asnList" v-loading="loading" stripe size="small" highlight-current-row @current-change="row => viewAsn(row?.id)">
      <el-table-column prop="asn_code" label="ASN 单号" width="150" />
      <el-table-column prop="supplier" label="供应商" width="120" />
      <el-table-column prop="expected_date" label="预计到货" width="110" />
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
          <el-button v-if="row.status === 'PENDING'" size="small" text type="danger" @click.stop="deleteAsn(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- ASN 详情 -->
    <div v-if="selectedAsn" class="asn-detail">
      <h3>ASN 详情 — {{ selectedAsn.asn_code }}</h3>
      <div class="detail-info">
        <span>供应商：{{ selectedAsn.supplier || '-' }}</span>
        <span>预计到货：{{ selectedAsn.expected_date || '-' }}</span>
        <span>总数量：{{ selectedAsn.total_qty }}</span>
        <span>已收货：{{ selectedAsn.received_qty }}</span>
        <span>短缺：{{ selectedAsn.shortage_qty }}</span>
        <span>损坏：{{ selectedAsn.damage_qty }}</span>
      </div>
      <el-table :data="selectedAsn.details" size="small" border style="margin-top:12px">
        <el-table-column prop="style_no" label="款号" width="120" />
        <el-table-column prop="fabric_name" label="面料" width="120" />
        <el-table-column prop="color" label="颜色" width="80" />
        <el-table-column prop="size_spec" label="规格" width="80" />
        <el-table-column prop="pot_no" label="缸号" width="100" />
        <el-table-column prop="plan_qty" label="计划数量" width="90" align="right" />
        <el-table-column prop="actual_qty" label="实际数量" width="90" align="right" />
        <el-table-column prop="shortage_qty" label="短缺" width="70" align="right" />
        <el-table-column prop="damage_qty" label="损坏" width="70" align="right" />
      </el-table>
    </div>

    <!-- 新建 ASN 对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建到货通知单" width="700px" top="5vh">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="供应商"><el-input v-model="createForm.supplier" /></el-form-item>
        <el-form-item label="预计到货"><el-input v-model="createForm.expected_date" type="date" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="createForm.remark" /></el-form-item>
      </el-form>

      <h4 style="margin:12px 0 8px">到货明细</h4>
      <el-table :data="details" size="small" border max-height="200">
        <el-table-column prop="style_no" label="款号" width="100" />
        <el-table-column prop="fabric_name" label="面料" width="100" />
        <el-table-column prop="color" label="颜色" width="70" />
        <el-table-column prop="pot_no" label="缸号" width="90" />
        <el-table-column prop="plan_qty" label="数量" width="80" />
        <el-table-column label="操作" width="60">
          <template #default="{ $index }">
            <el-button size="small" text type="danger" @click="removeDetail($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:end">
        <el-input v-model="detailForm.style_no" placeholder="款号" style="width:100px" />
        <el-input v-model="detailForm.fabric_name" placeholder="面料" style="width:100px" />
        <el-input v-model="detailForm.color" placeholder="颜色" style="width:70px" />
        <el-input v-model="detailForm.pot_no" placeholder="缸号" style="width:90px" />
        <el-input-number v-model="detailForm.plan_qty" :min="0" style="width:90px" />
        <el-button @click="addDetail" type="primary" text>+ 添加</el-button>
      </div>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="createAsn" :disabled="details.length === 0">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.asn-page { max-width: 1100px; }
.page-header-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-heading { font-size: 18px; font-weight: 700; }
.back-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px; }
.back-btn:hover { color: var(--primary); }

.asn-detail {
  margin-top: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.asn-detail h3 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.detail-info { display: flex; gap: 20px; font-size: 13px; color: var(--text-secondary); }
</style>
