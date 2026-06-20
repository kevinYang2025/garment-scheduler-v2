<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import ExcelTable from '../components/ExcelTable.vue'
import { useI18n } from '../composables/useI18n'
import { formatLocal as fmtLocal } from '../utils/date'

const { t } = useI18n()
const route = useRoute()

const props = defineProps({
  warehouseType: { type: String, default: '' },
})

// [2026-06-20 fix#前端-#] 兜底:props 缺失时从 route.params 取
//   router redirect 配置 params: { type: 'cutting_piece' } 不被部分 Vue Router 版本
//   继承到目标路由 → props.warehouseType=undefined → API /undefined/... → 400
const effectiveType = computed(() => props.warehouseType || route.params.type || 'cutting_piece')
watch(effectiveType, () => { loadAll() })

const router = useRouter()
const emit = defineEmits(['navigate'])

// [fix#前端-P2-2] 权限已由后端 requireRole 控制,前端保留函数占位以便未来扩展细粒度
function hasPermission(perm) {
  // eslint-disable-next-line no-unused-vars
  const _p = perm
  return true
}

const warehouseMeta = {
  raw_material: { label: '面料库', unit: '米' },
  auxiliary: { label: '辅料库', unit: '个/卷' },
  cutting_piece: { label: '裁片库', unit: '片' },
  finished: { label: '成品库', unit: '件' },
}

const meta = computed(() => warehouseMeta[effectiveType.value] || { label: '', unit: '' })
const isFabric = computed(() => effectiveType.value === 'raw_material')

const currentTab = ref('inventory')
const inbound = ref([])
const outbound = ref([])
const inventory = ref([])

const inboundDialogVisible = ref(false)
const outboundDialogVisible = ref(false)
const inboundForm = ref({})
const outboundForm = ref({})

// Import/export
const importDialogVisible = ref(false)
const importFile = ref(null)
const importPreview = ref(null)
const importing = ref(false)
const importSheetFilter = ref('') // ''=全部, 'inventory'|'inbound'|'outbound'

// --- Column definitions ---
const inventoryCols = computed(() => isFabric.value
  ? [
      { field: 'supplier', label: t('wh.col.supplier'), width: 120, type: 'text' },
      { field: 'customer', label: t('wh.col.customer'), width: 120, type: 'text' },
      { field: 'style_no', label: t('wh.col.styleNo'), width: 140, type: 'text' },
      { field: 'pot_no', label: t('wh.col.potNo'), width: 140, type: 'text' },
      { field: 'fabric_name', label: t('wh.col.fabricName'), width: 180, type: 'text' },
      { field: 'width', label: t('wh.col.width'), width: 80, type: 'text' },
      { field: 'weight', label: t('wh.col.weight'), width: 80, type: 'number' },
      { field: 'color', label: t('wh.col.color'), width: 120, type: 'text' },
      { field: 'current_qty', label: t('wh.col.currentQty'), width: 100, type: 'number' },
      { field: 'unit', label: t('wh.col.unit'), width: 70, type: 'text' },
      { field: 'total_pcs', label: t('wh.col.totalPcs'), width: 80, type: 'number' },
      { field: 'unit2', label: t('wh.col.unit2'), width: 70, type: 'text' },
      { field: 'updated_at', label: t('wh.col.updatedAt'), width: 160, type: 'date' },
    ]
  : [
      { field: 'style_no', label: t('wh.col.styleNo'), width: 120, type: 'text' },
      { field: 'color', label: t('wh.col.color'), width: 100, type: 'text' },
      { field: 'size_spec', label: t('wh.col.sizeSpec'), width: 100, type: 'text' },
      { field: 'current_qty', label: t('wh.col.currentQty'), width: 120, type: 'number' },
      { field: 'updated_at', label: t('wh.col.updatedAt'), width: 180, type: 'date' },
    ]
)

const inboundCols = computed(() => isFabric.value
  ? [
      { field: 'inbound_date', label: t('wh.col.inboundDate'), width: 110, type: 'date' },
      { field: 'order_no', label: t('wh.col.orderNo'), width: 160, type: 'text' },
      { field: 'supplier', label: t('wh.col.supplier'), width: 120, type: 'text' },
      { field: 'customer', label: t('wh.col.customer'), width: 120, type: 'text' },
      { field: 'style_no', label: t('wh.col.styleNo'), width: 140, type: 'text' },
      { field: 'pot_no', label: t('wh.col.potNo'), width: 140, type: 'text' },
      { field: 'fabric_name', label: t('wh.col.fabricName'), width: 180, type: 'text' },
      { field: 'width', label: t('wh.col.width'), width: 80, type: 'text' },
      { field: 'weight', label: t('wh.col.weight'), width: 80, type: 'number' },
      { field: 'color', label: t('wh.col.color'), width: 120, type: 'text' },
      { field: 'qty', label: t('wh.col.qty'), width: 90, type: 'number' },
      { field: 'unit', label: t('wh.col.unit'), width: 70, type: 'text' },
      { field: 'loading_qty', label: t('wh.col.loadingQty'), width: 90, type: 'number' },
      { field: 'total_pcs', label: t('wh.col.totalPcs'), width: 80, type: 'number' },
      { field: 'unit2', label: t('wh.col.unit2'), width: 70, type: 'text' },
      { field: 'remark', label: t('wh.col.remark'), width: 150, type: 'text' },
    ]
  : [
      { field: 'inbound_date', label: t('wh.col.date'), width: 120, type: 'date' },
      { field: 'style_no', label: t('wh.col.styleNo'), width: 120, type: 'text' },
      { field: 'color', label: t('wh.col.color'), width: 100, type: 'text' },
      { field: 'size_spec', label: t('wh.col.sizeSpec'), width: 100, type: 'text' },
      { field: 'qty', label: t('wh.col.qty'), width: 100, type: 'number' },
      { field: 'operator', label: t('wh.col.operator'), width: 100, type: 'text' },
    ]
)

const outboundCols = computed(() => isFabric.value
  ? [
      { field: 'outbound_date', label: t('wh.col.outboundDate'), width: 110, type: 'date' },
      { field: 'order_no', label: t('wh.col.orderNo'), width: 160, type: 'text' },
      { field: 'supplier', label: t('wh.col.supplier'), width: 120, type: 'text' },
      { field: 'customer', label: t('wh.col.customer'), width: 120, type: 'text' },
      { field: 'style_no', label: t('wh.col.styleNo'), width: 140, type: 'text' },
      { field: 'pot_no', label: t('wh.col.potNo'), width: 140, type: 'text' },
      { field: 'fabric_name', label: t('wh.col.fabricName'), width: 180, type: 'text' },
      { field: 'width', label: t('wh.col.width'), width: 80, type: 'text' },
      { field: 'weight', label: t('wh.col.weight'), width: 80, type: 'number' },
      { field: 'color', label: t('wh.col.color'), width: 120, type: 'text' },
      { field: 'qty', label: t('wh.col.qty'), width: 90, type: 'number' },
      { field: 'unit', label: t('wh.col.unit'), width: 70, type: 'text' },
      { field: 'total_pcs', label: t('wh.col.totalPcs'), width: 80, type: 'number' },
      { field: 'unit2', label: t('wh.col.unit2'), width: 70, type: 'text' },
      { field: 'remark', label: t('wh.col.remark'), width: 150, type: 'text' },
    ]
  : [
      { field: 'outbound_date', label: t('wh.col.date'), width: 120, type: 'date' },
      { field: 'style_no', label: t('wh.col.styleNo'), width: 120, type: 'text' },
      { field: 'color', label: t('wh.col.color'), width: 100, type: 'text' },
      { field: 'size_spec', label: t('wh.col.sizeSpec'), width: 100, type: 'text' },
      { field: 'qty', label: t('wh.col.qty'), width: 100, type: 'number' },
      { field: 'operator', label: t('wh.col.operator'), width: 100, type: 'text' },
    ]
)

// 款式下拉数据（从裁剪计划获取）
const styleOptions = ref([])
const outboundStyleOptions = ref([])
const styleLoading = ref(false)
let styleSearchTimer = null

async function searchStyles(keyword) {
  clearTimeout(styleSearchTimer)
  styleSearchTimer = setTimeout(async () => {
    styleLoading.value = true
    try {
      const { data } = await api.getMainPlanStyles(keyword || '')
      styleOptions.value = Array.isArray(data) ? data : []
    } catch {
      styleOptions.value = []
    }
    styleLoading.value = false
  }, 250)
}

// 颜色/尺码下拉数据（从分色分尺码获取）
const colorOptions = ref([])
const sizeOptions = ref([])

async function loadColorSizes(styleNo) {
  colorOptions.value = []
  sizeOptions.value = []
  if (!styleNo) return
  try {
    const { data } = await api.getStyleColorSize(styleNo)
    const rows = Array.isArray(data) ? data : []
    colorOptions.value = [...new Set(rows.map(r => r.color).filter(Boolean))]
    sizeOptions.value = [...new Set(rows.map(r => r.size_spec).filter(Boolean))]
  } catch { /* ignore */ }
}

// 出库：只搜索有库存的款号
async function searchInventoryStyles(keyword) {
  clearTimeout(styleSearchTimer)
  styleSearchTimer = setTimeout(async () => {
    styleLoading.value = true
    try {
      // [2026-06-20 段13 M-2] keyword+in_stock 全部走后端 SQL(替代 .filter)
      const { data } = await api.getWarehouseInventory(effectiveType.value, { keyword: keyword || '', in_stock: '1' })
      outboundStyleOptions.value = Array.isArray(data) ? data : []
    } catch {
      outboundStyleOptions.value = []
    }
    styleLoading.value = false
  }, 250)
}

// 面料装柜数据选择
const fabricOptions = ref([])
const fabricLoading = ref(false)
const fabricSelectKey = ref('')
const currentInventoryQty = ref(0)
let fabricSearchTimer = null

async function searchFabricOptions(keyword) {
  clearTimeout(fabricSearchTimer)
  fabricSearchTimer = setTimeout(async () => {
    fabricLoading.value = true
    try {
      const { data } = await api.get('/fabric-loading/options', { params: { keyword: keyword || '' } })
      fabricOptions.value = Array.isArray(data) ? data : []
    } catch {
      fabricOptions.value = []
    }
    fabricLoading.value = false
  }, 250)
}

function onFabricSelect(form, val) {
  const f = fabricOptions.value.find(item => `${item.style_no}|${item.pot_no}` === val)
  if (f) {
    form.style_no = f.style_no || ''
    form.pot_no = f.pot_no || ''
    form.fabric_name = f.fabric_name || ''
    form.supplier = f.supplier || ''
    form.customer = f.customer || ''
    form.color = f.color || ''
    form.width = f.width || ''
    form.weight = f.weight || ''
    form.unit = f.unit || 'KG'
    form.loading_qty = f.loading_qty || 0
    // 查当前库存
    const inv = inventory.value.find(i => i.style_no === f.style_no && i.pot_no === f.pot_no)
    currentInventoryQty.value = inv ? inv.current_qty : 0
  }
}

async function loadInbound() {
  try {
    const { data } = await api.getWarehouseInbound(effectiveType.value)
    inbound.value = Array.isArray(data) ? data : []
  } catch {
    ElMessage.error(t('wh.toast.loadInboundFail'))
  }
}

async function loadOutbound() {
  try {
    const { data } = await api.getWarehouseOutbound(effectiveType.value)
    outbound.value = Array.isArray(data) ? data : []
  } catch {
    ElMessage.error(t('wh.toast.loadOutboundFail'))
  }
}

async function loadInventory() {
  try {
    const { data } = await api.getWarehouseInventory(effectiveType.value)
    inventory.value = Array.isArray(data) ? data : []
  } catch {
    ElMessage.error(t('wh.toast.loadInvFail'))
  }
}

function loadAll() {
  loadInbound()
  loadOutbound()
  loadInventory()
}

function goToFabricList() {
  inboundDialogVisible.value = false
  emit('navigate', 'fabricList')
}

function openInbound() {
  inboundForm.value = {
    style_no: '', color: '', size_spec: '', qty: null,
    inbound_date: fmtLocal(new Date()), operator: '',
    pot_no: '', fabric_name: '', supplier: '', customer: '',
    width: '', weight: '', unit: 'KG', total_pcs: 0, unit2: '匹', remark: '',
    order_no: '（提交后自动生成）', loading_qty: 0,
  }
  fabricSelectKey.value = ''
  currentInventoryQty.value = 0
  if (isFabric.value) { fabricOptions.value = []; searchFabricOptions('') }
  else { styleOptions.value = []; searchStyles('') }
  inboundDialogVisible.value = true
}

function openOutbound() {
  outboundForm.value = {
    style_no: '', color: '', size_spec: '', qty: null,
    outbound_date: fmtLocal(new Date()), operator: '',
    pot_no: '', fabric_name: '', supplier: '', customer: '',
    width: '', weight: '', unit: 'KG', total_pcs: 0, unit2: '匹', remark: '',
    order_no: '（提交后自动生成）',
  }
  fabricSelectKey.value = ''
  currentInventoryQty.value = 0
  if (isFabric.value) { fabricOptions.value = []; searchFabricOptions('') }
  else { outboundStyleOptions.value = []; searchInventoryStyles('') }
  outboundDialogVisible.value = true
}

async function saveInbound() {
  if (!inboundForm.value.style_no) {
    ElMessage.warning(t('wh.toast.chooseStyle'))
    return
  }
  if (!inboundForm.value.qty || inboundForm.value.qty <= 0) {
    ElMessage.warning(t('wh.toast.enterQty'))
    return
  }
  try {
    const f = inboundForm.value
    const { data } = await api.createAsn({
      warehouse_type: effectiveType.value,
      supplier: f.supplier || '',
      expected_date: f.inbound_date || '',
      remark: f.remark || '',
      details: [{
        style_no: f.style_no,
        fabric_name: f.fabric_name || '',
        color: f.color || '',
        size_spec: f.size_spec || '',
        pot_no: f.pot_no || '',
        plan_qty: f.qty || 0,
        unit: f.unit || 'KG',
      }],
    })
    if (data.ok) {
      // 自动确认收货并完成入库
      await api.updateAsnStatus(data.id, { status: 'RECEIVED' })
      await api.updateAsnStatus(data.id, { status: 'COMPLETED' })
      ElMessage.success(t('wh.toast.inboundOk'))
      inboundDialogVisible.value = false
      loadAll()
    } else {
      ElMessage.error(data.error || t('wh.toast.inboundFail'))
    }
  } catch (e) {
    ElMessage.error(t('wh.toast.inboundFail') + ':' + (e.response?.data?.error || e.message))
  }
}

async function saveOutbound() {
  if (!outboundForm.value.style_no) {
    ElMessage.warning(t('wh.toast.chooseStyle'))
    return
  }
  if (!outboundForm.value.qty || outboundForm.value.qty <= 0) {
    ElMessage.warning(t('wh.toast.enterQty'))
    return
  }
  try {
    const f = outboundForm.value
    const { data } = await api.createDn({
      warehouse_type: effectiveType.value,
      customer: f.customer || '',
      ship_date: f.outbound_date || '',
      remark: f.remark || '',
      details: [{
        style_no: f.style_no,
        color: f.color || '',
        size_spec: f.size_spec || '',
        plan_qty: f.qty || 0,
        unit: f.unit || 'KG',
      }],
    })
    if (data.ok) {
      // 自动完成发货（扣减库存）
      await api.updateDnStatus(data.id, { status: 'SHIPPED' })
      ElMessage.success(t('wh.toast.outboundOk'))
      outboundDialogVisible.value = false
      loadAll()
    } else {
      ElMessage.error(data.error || t('wh.toast.outboundFail'))
    }
  } catch (e) {
    ElMessage.error(t('wh.toast.outboundFail') + ':' + (e.response?.data?.error || e.message))
  }
}

// 款号选择后自动填充颜色/规格
function onStyleChange(form, val) {
  const s = styleOptions.value.find(item => item.style_no === val)
  if (s) {
    form.color = s.color || form.color || ''
    form.size_spec = s.size_spec || form.size_spec || ''
  }
  // 加载该款的颜色/尺码选项
  loadColorSizes(val)
}

function onOutboundStyleChange(val) {
  const s = outboundStyleOptions.value.find(item => item.style_no === val)
  if (s) {
    outboundForm.value.color = s.color || ''
    outboundForm.value.size_spec = s.size_spec || ''
    outboundForm.value.pot_no = s.pot_no || ''
    outboundForm.value.fabric_name = s.fabric_name || ''
    outboundForm.value.supplier = s.supplier || ''
    outboundForm.value.customer = s.customer || ''
    outboundForm.value.width = s.width || ''
    outboundForm.value.weight = s.weight || ''
    outboundForm.value.unit = s.unit || 'KG'
    outboundForm.value.total_pcs = s.total_pcs || 0
    outboundForm.value.unit2 = s.unit2 || '匹'
    currentInventoryQty.value = s.current_qty || 0
  }
  // 从库存数据中提取该款的颜色/尺码选项
  const items = outboundStyleOptions.value.filter(i => i.style_no === val)
  colorOptions.value = [...new Set(items.map(i => i.color).filter(Boolean))]
  sizeOptions.value = [...new Set(items.map(i => i.size_spec).filter(Boolean))]
}

// Export
function doExport(sheet) {
  api.downloadFile(`/warehouse/${effectiveType.value}/export`, sheet ? { sheet } : null, `${effectiveType.value}-inventory.xlsx`)
}

// Import
function onImportFileChange(e) {
  importFile.value = e.target.files[0]
}

async function doImport() {
  if (!importFile.value) return
  importing.value = true
  try {
    const XLSX = await import('xlsx')
    const data = await importFile.value.arrayBuffer()
    const wb = XLSX.read(data, { type: 'array' })
    const records = []
    for (const sn of wb.SheetNames) {
      // 如果指定了只导入某个类型，跳过其他Sheet
      const sheetTypeMap = { '库存': 'inventory', '入库记录': 'inbound', '出库记录': 'outbound' }
      if (importSheetFilter.value && sheetTypeMap[sn] !== importSheetFilter.value) continue
      const ws = wb.Sheets[sn]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
      if (rows.length < 2) continue
      const headers = rows[0]
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row || row.every(c => c == null || c === '')) continue
        const rec = { _sheet: sn }
        for (let j = 0; j < Math.min(headers.length, row.length); j++) {
          if (headers[j]) rec[String(headers[j]).trim()] = row[j]
        }
        records.push(rec)
      }
    }
    importPreview.value = records
  } catch (e) {
    ElMessage.error(t('wh.toast.parseFail') + ': ' + e.message)
  }
  importing.value = false
}

function openImport(filter) {
  importSheetFilter.value = filter
  importFile.value = null
  importPreview.value = null
  importDialogVisible.value = true
}

async function confirmImport() {
  if (!importPreview.value?.length) return
  importing.value = true
  try {
    const { data } = await api.importWarehouse(effectiveType.value, importPreview.value)
    ElMessage.success(t('wh.toast.importOk', null, { count: data.imported }))
    importDialogVisible.value = false
    importPreview.value = null
    importFile.value = null
    loadAll()
  } catch (e) {
    ElMessage.error(t('wh.toast.importFail') + ': ' + (e.response?.data?.error || e.message))
  }
  importing.value = false
}

watch(() => effectiveType.value, loadAll)
onMounted(loadAll)
</script>

<template>
  <div class="warehouse-detail">
    <!-- 顶部操作栏 -->
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="router.back()">
          <span style="margin-right:4px">←</span> {{ t('wh.back') }}
        </el-button>
        <h2>{{ meta.label }}</h2>
      </div>
      <div class="header-actions">
        <el-button
          v-if="hasPermission(`warehouse:${effectiveType}:inbound`)"
          type="primary"
          size="large"
          @click="openInbound"
        >
          {{ t('wh.inboundBtn') }}
        </el-button>
        <el-button
          v-if="hasPermission(`warehouse:${effectiveType}:outbound`)"
          type="warning"
          size="large"
          @click="openOutbound"
        >
          {{ t('wh.outboundBtn') }}
        </el-button>
        <el-divider direction="vertical" />
        <el-dropdown @command="doExport" style="margin-right:0">
          <el-button>{{ t('wh.exportExcel') }}<el-icon class="el-icon--right"><i class="arrow-down" /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="inventory">{{ t('wh.export.currentInventory') }}</el-dropdown-item>
              <el-dropdown-item command="inbound">{{ t('wh.export.currentInbound') }}</el-dropdown-item>
              <el-dropdown-item command="outbound">{{ t('wh.export.currentOutbound') }}</el-dropdown-item>
              <el-dropdown-item divided command="">{{ t('wh.export.all') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown @command="openImport">
          <el-button>{{ t('wh.importExcel') }}<el-icon class="el-icon--right"><i class="arrow-down" /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="inventory">{{ t('wh.import.invSheet') }}</el-dropdown-item>
              <el-dropdown-item command="inbound">{{ t('wh.import.inboundSheet') }}</el-dropdown-item>
              <el-dropdown-item command="outbound">{{ t('wh.import.outboundSheet') }}</el-dropdown-item>
              <el-dropdown-item divided command="">{{ t('wh.import.all') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 标签页 -->
    <el-tabs v-model="currentTab" class="detail-tabs">
      <el-tab-pane :label="t('wh.tab.inventory')" name="inventory">
        <ExcelTable
          :columns="inventoryCols"
          :data="inventory"
          row-key="id"
        />
      </el-tab-pane>

      <el-tab-pane :label="t('wh.tab.inbound')" name="inbound">
        <ExcelTable
          :columns="inboundCols"
          :data="inbound"
          row-key="id"
        />
      </el-tab-pane>

      <el-tab-pane :label="t('wh.tab.outbound')" name="outbound">
        <ExcelTable
          :columns="outboundCols"
          :data="outbound"
          row-key="id"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 入库弹窗 -->
    <el-dialog v-model="inboundDialogVisible" :title="t('wh.inboundBtn')" :width="isFabric ? '800px' : '480px'">
      <el-form :model="inboundForm" :label-width="isFabric ? '80px' : '80px'" size="default">
        <!-- 面料库：从装柜数据选择 -->
        <template v-if="isFabric">
          <el-form-item :label="t('wh.col.fabricData')">
            <el-select
              v-model="fabricSelectKey"
              filterable
              remote
              reserve-keyword
              :placeholder="t('wh.form.fabricPh')"
              :remote-method="searchFabricOptions"
              :loading="fabricLoading"
              style="width:100%"
              @change="onFabricSelect(inboundForm, $event)"
            >
              <el-option
                v-for="(f, idx) in fabricOptions"
                :key="idx"
                :label="`${f.style_no} | ${f.pot_no} | ${f.fabric_name} | ${f.color}`"
                :value="`${f.style_no}|${f.pot_no}`"
              />
            </el-select>
          </el-form-item>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item :label="t('wh.col.styleNo')"><el-input v-model="inboundForm.style_no" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.potNo')"><el-input v-model="inboundForm.pot_no" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.fabricName')"><el-input v-model="inboundForm.fabric_name" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item :label="t('wh.col.supplier')"><el-input v-model="inboundForm.supplier" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.customer')"><el-input v-model="inboundForm.customer" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.color')"><el-input v-model="inboundForm.color" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item :label="t('wh.col.width')"><el-input v-model="inboundForm.width" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item :label="t('wh.col.weight')"><el-input v-model="inboundForm.weight" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item :label="t('wh.col.qty')" required><el-input-number v-model="inboundForm.qty" :min="0" :precision="1" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item :label="t('wh.col.unit')"><el-input v-model="inboundForm.unit" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item :label="t('wh.col.totalPcs')"><el-input-number v-model="inboundForm.total_pcs" :min="0" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item :label="t('wh.col.date')"><el-input v-model="inboundForm.inbound_date" type="date" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item :label="t('wh.col.remark')"><el-input v-model="inboundForm.remark" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item :label="t('wh.col.orderNo')"><el-input v-model="inboundForm.order_no" disabled /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.form.currentStock')"><el-input :model-value="currentInventoryQty" readonly /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.loadingQty')"><el-input :model-value="inboundForm.loading_qty" readonly /></el-form-item></el-col>
          </el-row>
        </template>
        <!-- 其他仓库：原有表单 -->
        <template v-else>
          <el-form-item :label="t('wh.col.styleNo')" required>
            <el-select v-model="inboundForm.style_no" filterable remote reserve-keyword :placeholder="t('wh.form.stylePh')" :remote-method="searchStyles" :loading="styleLoading" style="width:100%" @change="onStyleChange(inboundForm, $event)">
              <el-option v-for="s in styleOptions" :key="s.style_no" :label="`${s.style_no} - ${s.product_name || ''} ${s.due_date || ''}`" :value="s.style_no" />
            </el-select>
          </el-form-item>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item :label="t('wh.col.color')">
                <el-select v-model="inboundForm.color" filterable allow-create :placeholder="t('wh.col.color')" style="width:100%">
                  <el-option v-for="c in colorOptions" :key="c" :label="c" :value="c" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('wh.col.sizeSpec')">
                <el-select v-model="inboundForm.size_spec" filterable allow-create :placeholder="t('wh.col.sizeSpec')" style="width:100%">
                  <el-option v-for="s in sizeOptions" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item :label="t('wh.col.qty')" required><el-input-number v-model="inboundForm.qty" :min="1" :precision="0" style="width:100%" /><span class="unit-suffix">{{ meta.unit }}</span></el-form-item></el-col>
            <el-col :span="12"><el-form-item :label="t('wh.col.date')"><el-input v-model="inboundForm.inbound_date" type="date" /></el-form-item></el-col>
          </el-row>
          <el-form-item :label="t('wh.col.operator')"><el-input v-model="inboundForm.operator" :placeholder="t('common.optional')" /></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button v-if="isFabric" @click="goToFabricList" style="margin-right:auto">📑 {{ t('wh.form.batchInbound') }}</el-button>
        <el-button @click="inboundDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveInbound">{{ t('wh.form.confirmInbound') }}</el-button>
      </template>
    </el-dialog>

    <!-- 出库弹窗 -->
    <el-dialog v-model="outboundDialogVisible" :title="t('wh.outboundBtn')" :width="isFabric ? '800px' : '480px'">
      <el-form :model="outboundForm" :label-width="isFabric ? '80px' : '80px'" size="default">
        <!-- 面料库：从装柜数据选择 -->
        <template v-if="isFabric">
          <el-form-item :label="t('wh.col.fabricData')">
            <el-select
              v-model="fabricSelectKey"
              filterable
              remote
              reserve-keyword
              :placeholder="t('wh.form.fabricPh')"
              :remote-method="searchFabricOptions"
              :loading="fabricLoading"
              style="width:100%"
              @change="onFabricSelect(outboundForm, $event)"
            >
              <el-option
                v-for="(f, idx) in fabricOptions"
                :key="idx"
                :label="`${f.style_no} | ${f.pot_no} | ${f.fabric_name} | ${f.color}`"
                :value="`${f.style_no}|${f.pot_no}`"
              />
            </el-select>
          </el-form-item>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item :label="t('wh.col.styleNo')"><el-input v-model="outboundForm.style_no" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.potNo')"><el-input v-model="outboundForm.pot_no" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.fabricName')"><el-input v-model="outboundForm.fabric_name" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item :label="t('wh.col.supplier')"><el-input v-model="outboundForm.supplier" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.customer')"><el-input v-model="outboundForm.customer" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.col.color')"><el-input v-model="outboundForm.color" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item :label="t('wh.col.width')"><el-input v-model="outboundForm.width" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item :label="t('wh.col.weight')"><el-input v-model="outboundForm.weight" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item :label="t('wh.col.qty')" required><el-input-number v-model="outboundForm.qty" :min="0" :precision="1" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item :label="t('wh.col.unit')"><el-input v-model="outboundForm.unit" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item :label="t('wh.col.totalPcs')"><el-input-number v-model="outboundForm.total_pcs" :min="0" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item :label="t('wh.col.date')"><el-input v-model="outboundForm.outbound_date" type="date" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item :label="t('wh.col.remark')"><el-input v-model="outboundForm.remark" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item :label="t('wh.col.orderNo')"><el-input v-model="outboundForm.order_no" disabled /></el-form-item></el-col>
            <el-col :span="8"><el-form-item :label="t('wh.form.currentStock')"><el-input :model-value="currentInventoryQty" readonly /></el-form-item></el-col>
            <el-col :span="8"></el-col>
          </el-row>
        </template>
        <!-- 其他仓库：原有表单 -->
        <template v-else>
          <el-form-item :label="t('wh.col.styleNo')" required>
            <el-select v-model="outboundForm.style_no" filterable remote reserve-keyword :placeholder="t('wh.form.outboundStylePh')" :remote-method="searchInventoryStyles" :loading="styleLoading" style="width:100%" @change="onOutboundStyleChange($event)">
              <el-option v-for="s in outboundStyleOptions" :key="`${s.style_no}_${s.color}_${s.size_spec}`" :label="`${s.style_no} - ${s.color || ''} ${s.size_spec || ''} (${t('wh.col.currentQty')}:${s.current_qty})`" :value="s.style_no" />
            </el-select>
          </el-form-item>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item :label="t('wh.col.color')">
                <el-select v-model="outboundForm.color" filterable allow-create :placeholder="t('wh.col.color')" style="width:100%">
                  <el-option v-for="c in colorOptions" :key="c" :label="c" :value="c" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('wh.col.sizeSpec')">
                <el-select v-model="outboundForm.size_spec" filterable allow-create :placeholder="t('wh.col.sizeSpec')" style="width:100%">
                  <el-option v-for="s in sizeOptions" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item :label="t('wh.col.qty')" required><el-input-number v-model="outboundForm.qty" :min="1" :precision="0" style="width:100%" /><span class="unit-suffix">{{ meta.unit }}</span></el-form-item></el-col>
            <el-col :span="12"><el-form-item :label="t('wh.col.date')"><el-input v-model="outboundForm.outbound_date" type="date" /></el-form-item></el-col>
          </el-row>
          <el-form-item :label="t('wh.col.operator')"><el-input v-model="outboundForm.operator" :placeholder="t('common.optional')" /></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="outboundDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="warning" @click="saveOutbound">{{ t('wh.form.confirmOutbound') }}</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importDialogVisible" :title="importSheetFilter ? t('wh.importExcel') + t('wh.sheet.' + importSheetFilter) : t('wh.import.allTitle')" width="600px">
      <div v-if="importSheetFilter" style="margin-bottom:8px;font-size:12px;color:var(--primary-dark)">
        {{ t('wh.import.sheetOnly', null, { sheet: t('wh.sheet.' + importSheetFilter) }) }}
      </div>
      <div style="margin-bottom:12px">
        <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" />
        <span v-if="importFile" style="margin-left:8px;color:var(--primary-dark)">{{ importFile.name }}</span>
      </div>
      <div v-if="importFile" style="margin-bottom:12px">
        <el-button @click="doImport" type="primary" :loading="importing">{{ t('wh.import.parsePreview') }}</el-button>
      </div>
      <div v-if="importPreview?.length" style="max-height:300px;overflow:auto">
        <div style="margin-bottom:4px;font-size:12px;color:var(--text-secondary)">{{ t('wh.import.records', null, { count: importPreview.length }) }}</div>
        <el-table :data="importPreview" size="small" border max-height="220">
          <el-table-column :label="t('wh.import.colSheet')" width="80"><template #default="{row}">{{ row._sheet }}</template></el-table-column>
          <el-table-column :label="t('wh.col.styleNo')" width="100"><template #default="{row}">{{ row['款号'] || row.style_no }}</template></el-table-column>
          <el-table-column :label="t('wh.import.colColorSpec')" width="120"><template #default="{row}">{{ row['颜色'] || row.color }}/{{ row['规格'] || row.size_spec }}</template></el-table-column>
          <el-table-column :label="t('wh.col.qty')" width="80"><template #default="{row}">{{ row['数量'] || row['当前库存'] || row.qty }}</template></el-table-column>
          <el-table-column :label="t('wh.col.date')" width="110"><template #default="{row}">{{ row['入库日期'] || row['出库日期'] || '' }}</template></el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="confirmImport" :loading="importing" :disabled="!importPreview?.length">{{ t('wh.import.confirmImport') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.warehouse-detail {
  max-width: 1200px;
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.header-left h2 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}
.header-actions {
  display: flex;
  gap: 10px;
}
.detail-tabs {
  margin-top: 8px;
}
.unit-suffix {
  margin-left: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
