<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import ExcelTable from '../components/ExcelTable.vue'

const props = defineProps({
  warehouseType: { type: String, required: true },
})

const emit = defineEmits(['back', 'navigate'])

// TODO: 权限判断接口，后续对接实际权限系统
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

const meta = computed(() => warehouseMeta[props.warehouseType] || { label: '', unit: '' })
const isFabric = computed(() => props.warehouseType === 'raw_material')

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

function fmtLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// --- Column definitions ---
const inventoryCols = computed(() => isFabric.value
  ? [
      { field: 'supplier', label: '供应商', width: 120, type: 'text' },
      { field: 'customer', label: '客户', width: 120, type: 'text' },
      { field: 'style_no', label: '款号', width: 140, type: 'text' },
      { field: 'pot_no', label: '锅号', width: 140, type: 'text' },
      { field: 'fabric_name', label: '面料名称', width: 180, type: 'text' },
      { field: 'width', label: '幅宽', width: 80, type: 'text' },
      { field: 'weight', label: '克重', width: 80, type: 'number' },
      { field: 'color', label: '颜色', width: 120, type: 'text' },
      { field: 'current_qty', label: '当前库存', width: 100, type: 'number' },
      { field: 'unit', label: '单位', width: 70, type: 'text' },
      { field: 'total_pcs', label: '总匹数', width: 80, type: 'number' },
      { field: 'unit2', label: '单位2', width: 70, type: 'text' },
      { field: 'updated_at', label: '更新时间', width: 160, type: 'date' },
    ]
  : [
      { field: 'style_no', label: '款号', width: 120, type: 'text' },
      { field: 'color', label: '颜色', width: 100, type: 'text' },
      { field: 'size_spec', label: '规格', width: 100, type: 'text' },
      { field: 'current_qty', label: '当前库存', width: 120, type: 'number' },
      { field: 'updated_at', label: '更新时间', width: 180, type: 'date' },
    ]
)

const inboundCols = computed(() => isFabric.value
  ? [
      { field: 'inbound_date', label: '入库日期', width: 110, type: 'date' },
      { field: 'order_no', label: '入库单号', width: 160, type: 'text' },
      { field: 'supplier', label: '供应商', width: 120, type: 'text' },
      { field: 'customer', label: '客户', width: 120, type: 'text' },
      { field: 'style_no', label: '款号', width: 140, type: 'text' },
      { field: 'pot_no', label: '锅号', width: 140, type: 'text' },
      { field: 'fabric_name', label: '面料名称', width: 180, type: 'text' },
      { field: 'width', label: '幅宽', width: 80, type: 'text' },
      { field: 'weight', label: '克重', width: 80, type: 'number' },
      { field: 'color', label: '颜色', width: 120, type: 'text' },
      { field: 'qty', label: '数量', width: 90, type: 'number' },
      { field: 'unit', label: '单位', width: 70, type: 'text' },
      { field: 'loading_qty', label: '装柜数量', width: 90, type: 'number' },
      { field: 'total_pcs', label: '总匹数', width: 80, type: 'number' },
      { field: 'unit2', label: '单位2', width: 70, type: 'text' },
      { field: 'remark', label: '备注', width: 150, type: 'text' },
    ]
  : [
      { field: 'inbound_date', label: '日期', width: 120, type: 'date' },
      { field: 'style_no', label: '款号', width: 120, type: 'text' },
      { field: 'color', label: '颜色', width: 100, type: 'text' },
      { field: 'size_spec', label: '规格', width: 100, type: 'text' },
      { field: 'qty', label: '数量', width: 100, type: 'number' },
      { field: 'operator', label: '操作人', width: 100, type: 'text' },
    ]
)

const outboundCols = computed(() => isFabric.value
  ? [
      { field: 'outbound_date', label: '出库日期', width: 110, type: 'date' },
      { field: 'order_no', label: '出库单号', width: 160, type: 'text' },
      { field: 'supplier', label: '供应商', width: 120, type: 'text' },
      { field: 'customer', label: '客户', width: 120, type: 'text' },
      { field: 'style_no', label: '款号', width: 140, type: 'text' },
      { field: 'pot_no', label: '锅号', width: 140, type: 'text' },
      { field: 'fabric_name', label: '面料名称', width: 180, type: 'text' },
      { field: 'width', label: '幅宽', width: 80, type: 'text' },
      { field: 'weight', label: '克重', width: 80, type: 'number' },
      { field: 'color', label: '颜色', width: 120, type: 'text' },
      { field: 'qty', label: '数量', width: 90, type: 'number' },
      { field: 'unit', label: '单位', width: 70, type: 'text' },
      { field: 'total_pcs', label: '总匹数', width: 80, type: 'number' },
      { field: 'unit2', label: '单位2', width: 70, type: 'text' },
      { field: 'remark', label: '备注', width: 150, type: 'text' },
    ]
  : [
      { field: 'outbound_date', label: '日期', width: 120, type: 'date' },
      { field: 'style_no', label: '款号', width: 120, type: 'text' },
      { field: 'color', label: '颜色', width: 100, type: 'text' },
      { field: 'size_spec', label: '规格', width: 100, type: 'text' },
      { field: 'qty', label: '数量', width: 100, type: 'number' },
      { field: 'operator', label: '操作人', width: 100, type: 'text' },
    ]
)

// 款式下拉数据（远程搜索）
const styleOptions = ref([])
const outboundStyleOptions = ref([])
const styleLoading = ref(false)
let styleSearchTimer = null

async function searchStyles(keyword) {
  clearTimeout(styleSearchTimer)
  styleSearchTimer = setTimeout(async () => {
    styleLoading.value = true
    try {
      const { data } = await api.getStyles(keyword || '')
      styleOptions.value = Array.isArray(data) ? data : []
    } catch {
      styleOptions.value = []
    }
    styleLoading.value = false
  }, 250)
}

// 出库：只搜索有库存的款号
async function searchInventoryStyles(keyword) {
  clearTimeout(styleSearchTimer)
  styleSearchTimer = setTimeout(async () => {
    styleLoading.value = true
    try {
      const { data } = await api.getWarehouseInventory(props.warehouseType)
      const items = Array.isArray(data) ? data : []
      const filtered = keyword
        ? items.filter(r => (r.style_no || '').includes(keyword) || (r.color || '').includes(keyword) || (r.fabric_name || '').includes(keyword))
        : items
      outboundStyleOptions.value = filtered.filter(r => r.current_qty > 0)
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
    const { data } = await api.getWarehouseInbound(props.warehouseType)
    inbound.value = Array.isArray(data) ? data : []
  } catch {
    ElMessage.error('加载入库记录失败')
  }
}

async function loadOutbound() {
  try {
    const { data } = await api.getWarehouseOutbound(props.warehouseType)
    outbound.value = Array.isArray(data) ? data : []
  } catch {
    ElMessage.error('加载出库记录失败')
  }
}

async function loadInventory() {
  try {
    const { data } = await api.getWarehouseInventory(props.warehouseType)
    inventory.value = Array.isArray(data) ? data : []
  } catch {
    ElMessage.error('加载库存失败')
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
    ElMessage.warning('请选择款号')
    return
  }
  if (!inboundForm.value.qty || inboundForm.value.qty <= 0) {
    ElMessage.warning('请输入有效数量')
    return
  }
  try {
    const f = inboundForm.value
    const { data } = await api.createAsn({
      warehouse_type: props.warehouseType,
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
      ElMessage.success('入库成功')
      inboundDialogVisible.value = false
      loadAll()
    } else {
      ElMessage.error(data.error || '入库失败')
    }
  } catch (e) {
    ElMessage.error('入库失败：' + (e.response?.data?.error || e.message))
  }
}

async function saveOutbound() {
  if (!outboundForm.value.style_no) {
    ElMessage.warning('请选择款号')
    return
  }
  if (!outboundForm.value.qty || outboundForm.value.qty <= 0) {
    ElMessage.warning('请输入有效数量')
    return
  }
  try {
    const f = outboundForm.value
    const { data } = await api.createDn({
      warehouse_type: props.warehouseType,
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
      ElMessage.success('出库成功')
      outboundDialogVisible.value = false
      loadAll()
    } else {
      ElMessage.error(data.error || '出库失败')
    }
  } catch (e) {
    ElMessage.error('出库失败：' + (e.response?.data?.error || e.message))
  }
}

// 款号选择后自动填充颜色/规格
function onStyleChange(form, val) {
  const s = styleOptions.value.find(item => item.style_no === val)
  if (s) {
    form.color = s.color || form.color || ''
    form.size_spec = s.size_spec || form.size_spec || ''
  }
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
}

// Export
function doExport(sheet) {
  const params = sheet ? `?sheet=${sheet}` : ''
  window.open(`/api/warehouse/${props.warehouseType}/export${params}`, '_blank')
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
    ElMessage.error('解析Excel失败: ' + e.message)
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
    const { data } = await api.importWarehouse(props.warehouseType, importPreview.value)
    ElMessage.success(`导入完成: ${data.imported} 条`)
    importDialogVisible.value = false
    importPreview.value = null
    importFile.value = null
    loadAll()
  } catch (e) {
    ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message))
  }
  importing.value = false
}

watch(() => props.warehouseType, loadAll)
onMounted(loadAll)
</script>

<template>
  <div class="warehouse-detail">
    <!-- 顶部操作栏 -->
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="emit('back')">
          <span style="margin-right:4px">←</span> 返回
        </el-button>
        <h2>{{ meta.label }}</h2>
      </div>
      <div class="header-actions">
        <el-button
          v-if="hasPermission(`warehouse:${warehouseType}:inbound`)"
          type="primary"
          size="large"
          @click="openInbound"
        >
          入库
        </el-button>
        <el-button
          v-if="hasPermission(`warehouse:${warehouseType}:outbound`)"
          type="warning"
          size="large"
          @click="openOutbound"
        >
          出库
        </el-button>
        <el-divider direction="vertical" />
        <el-dropdown @command="doExport" style="margin-right:0">
          <el-button>导出Excel<el-icon class="el-icon--right"><i class="arrow-down" /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="inventory">导当前 — 库存</el-dropdown-item>
              <el-dropdown-item command="inbound">导当前 — 入库记录</el-dropdown-item>
              <el-dropdown-item command="outbound">导当前 — 出库记录</el-dropdown-item>
              <el-dropdown-item divided command="">全部导出（3个Sheet）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown @command="openImport">
          <el-button>导入Excel<el-icon class="el-icon--right"><i class="arrow-down" /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="inventory">导当前 — 库存</el-dropdown-item>
              <el-dropdown-item command="inbound">导当前 — 入库记录</el-dropdown-item>
              <el-dropdown-item command="outbound">导当前 — 出库记录</el-dropdown-item>
              <el-dropdown-item divided command="">全部导入（自动识别）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 标签页 -->
    <el-tabs v-model="currentTab" class="detail-tabs">
      <el-tab-pane label="动态库存" name="inventory">
        <ExcelTable
          :columns="inventoryCols"
          :data="inventory"
          row-key="id"
        />
      </el-tab-pane>

      <el-tab-pane label="入库记录" name="inbound">
        <ExcelTable
          :columns="inboundCols"
          :data="inbound"
          row-key="id"
        />
      </el-tab-pane>

      <el-tab-pane label="出库记录" name="outbound">
        <ExcelTable
          :columns="outboundCols"
          :data="outbound"
          row-key="id"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 入库弹窗 -->
    <el-dialog v-model="inboundDialogVisible" title="入库" :width="isFabric ? '800px' : '480px'">
      <el-form :model="inboundForm" :label-width="isFabric ? '80px' : '80px'" size="default">
        <!-- 面料库：从装柜数据选择 -->
        <template v-if="isFabric">
          <el-form-item label="装柜数据">
            <el-select
              v-model="fabricSelectKey"
              filterable
              remote
              reserve-keyword
              placeholder="输入款号、锅号或面料名称搜索..."
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
            <el-col :span="8"><el-form-item label="款号"><el-input v-model="inboundForm.style_no" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="锅号"><el-input v-model="inboundForm.pot_no" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="面料名称"><el-input v-model="inboundForm.fabric_name" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item label="供应商"><el-input v-model="inboundForm.supplier" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="客户"><el-input v-model="inboundForm.customer" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="颜色"><el-input v-model="inboundForm.color" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item label="幅宽"><el-input v-model="inboundForm.width" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="克重"><el-input v-model="inboundForm.weight" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="数量" required><el-input-number v-model="inboundForm.qty" :min="0" :precision="1" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="单位"><el-input v-model="inboundForm.unit" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item label="总匹数"><el-input-number v-model="inboundForm.total_pcs" :min="0" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="日期"><el-input v-model="inboundForm.inbound_date" type="date" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="备注"><el-input v-model="inboundForm.remark" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item label="入库单号"><el-input v-model="inboundForm.order_no" disabled /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="当前库存"><el-input :model-value="currentInventoryQty" readonly /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="装柜数量"><el-input :model-value="inboundForm.loading_qty" readonly /></el-form-item></el-col>
          </el-row>
        </template>
        <!-- 其他仓库：原有表单 -->
        <template v-else>
          <el-form-item label="款号" required>
            <el-select v-model="inboundForm.style_no" filterable remote reserve-keyword placeholder="输入款号搜索..." :remote-method="searchStyles" :loading="styleLoading" style="width:100%" @change="onStyleChange(inboundForm, $event)">
              <el-option v-for="s in styleOptions" :key="s.id" :label="`${s.style_no} - ${s.product_name || ''} ${s.color} ${s.size_spec}`" :value="s.style_no" />
            </el-select>
          </el-form-item>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="颜色"><el-input v-model="inboundForm.color" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="规格"><el-input v-model="inboundForm.size_spec" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="数量" required><el-input-number v-model="inboundForm.qty" :min="1" :precision="0" style="width:100%" /><span class="unit-suffix">{{ meta.unit }}</span></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="日期"><el-input v-model="inboundForm.inbound_date" type="date" /></el-form-item></el-col>
          </el-row>
          <el-form-item label="操作人"><el-input v-model="inboundForm.operator" placeholder="可选" /></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button v-if="isFabric" @click="goToFabricList" style="margin-right:auto">📑 从装柜清单批量入库</el-button>
        <el-button @click="inboundDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveInbound">确认入库</el-button>
      </template>
    </el-dialog>

    <!-- 出库弹窗 -->
    <el-dialog v-model="outboundDialogVisible" title="出库" :width="isFabric ? '800px' : '480px'">
      <el-form :model="outboundForm" :label-width="isFabric ? '80px' : '80px'" size="default">
        <!-- 面料库：从装柜数据选择 -->
        <template v-if="isFabric">
          <el-form-item label="装柜数据">
            <el-select
              v-model="fabricSelectKey"
              filterable
              remote
              reserve-keyword
              placeholder="输入款号、锅号或面料名称搜索..."
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
            <el-col :span="8"><el-form-item label="款号"><el-input v-model="outboundForm.style_no" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="锅号"><el-input v-model="outboundForm.pot_no" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="面料名称"><el-input v-model="outboundForm.fabric_name" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item label="供应商"><el-input v-model="outboundForm.supplier" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="客户"><el-input v-model="outboundForm.customer" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="颜色"><el-input v-model="outboundForm.color" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item label="幅宽"><el-input v-model="outboundForm.width" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="克重"><el-input v-model="outboundForm.weight" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="数量" required><el-input-number v-model="outboundForm.qty" :min="0" :precision="1" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="单位"><el-input v-model="outboundForm.unit" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item label="总匹数"><el-input-number v-model="outboundForm.total_pcs" :min="0" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="日期"><el-input v-model="outboundForm.outbound_date" type="date" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="备注"><el-input v-model="outboundForm.remark" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item label="出库单号"><el-input v-model="outboundForm.order_no" disabled /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="当前库存"><el-input :model-value="currentInventoryQty" readonly /></el-form-item></el-col>
            <el-col :span="8"></el-col>
          </el-row>
        </template>
        <!-- 其他仓库：原有表单 -->
        <template v-else>
          <el-form-item label="款号" required>
            <el-select v-model="outboundForm.style_no" filterable remote reserve-keyword placeholder="输入款号搜索有库存的款..." :remote-method="searchInventoryStyles" :loading="styleLoading" style="width:100%" @change="onOutboundStyleChange($event)">
              <el-option v-for="s in outboundStyleOptions" :key="s.id" :label="`${s.style_no} - ${s.fabric_name || ''} ${s.color} (库存:${s.current_qty})`" :value="s.style_no" />
            </el-select>
          </el-form-item>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="颜色"><el-input v-model="outboundForm.color" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="规格"><el-input v-model="outboundForm.size_spec" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="数量" required><el-input-number v-model="outboundForm.qty" :min="1" :precision="0" style="width:100%" /><span class="unit-suffix">{{ meta.unit }}</span></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="日期"><el-input v-model="outboundForm.outbound_date" type="date" /></el-form-item></el-col>
          </el-row>
          <el-form-item label="操作人"><el-input v-model="outboundForm.operator" placeholder="可选" /></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="outboundDialogVisible = false">取消</el-button>
        <el-button type="warning" @click="saveOutbound">确认出库</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importDialogVisible" :title="importSheetFilter ? '导入' + {inventory:'库存',inbound:'入库记录',outbound:'出库记录'}[importSheetFilter] : '导入Excel（全部）'" width="600px">
      <div v-if="importSheetFilter" style="margin-bottom:8px;font-size:12px;color:var(--primary-dark)">
        仅导入 Excel 中"{{ {inventory:'库存',inbound:'入库记录',outbound:'出库记录'}[importSheetFilter] }}"Sheet，其他 Sheet 自动跳过
      </div>
      <div style="margin-bottom:12px">
        <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" />
        <span v-if="importFile" style="margin-left:8px;color:var(--primary-dark)">{{ importFile.name }}</span>
      </div>
      <div v-if="importFile" style="margin-bottom:12px">
        <el-button @click="doImport" type="primary" :loading="importing">解析预览</el-button>
      </div>
      <div v-if="importPreview?.length" style="max-height:300px;overflow:auto">
        <div style="margin-bottom:4px;font-size:12px;color:var(--text-secondary)">共 {{ importPreview.length }} 条记录</div>
        <el-table :data="importPreview" size="small" border max-height="220">
          <el-table-column label="Sheet" width="80"><template #default="{row}">{{ row._sheet }}</template></el-table-column>
          <el-table-column label="款号" width="100"><template #default="{row}">{{ row['款号'] || row.style_no }}</template></el-table-column>
          <el-table-column label="颜色/规格" width="120"><template #default="{row}">{{ row['颜色'] || row.color }}/{{ row['规格'] || row.size_spec }}</template></el-table-column>
          <el-table-column label="数量" width="80"><template #default="{row}">{{ row['数量'] || row['当前库存'] || row.qty }}</template></el-table-column>
          <el-table-column label="日期" width="110"><template #default="{row}">{{ row['入库日期'] || row['出库日期'] || '' }}</template></el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmImport" :loading="importing" :disabled="!importPreview?.length">确认导入</el-button>
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
