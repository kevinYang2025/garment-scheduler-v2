<script setup>
// template 排程详情(使用共享 composable,详见 useSecPlanDetail.js)
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'
import TextFilter from '../components/TextFilter.vue'
import NumberFilter from '../components/NumberFilter.vue'
import { useSecPlanDetail } from '../composables/useSecPlanDetail'
import { todayLocal } from '../utils/date'
import { useAuthStore } from '../stores/auth'
import { canEditActual } from '../utils/permissions'

const router = useRouter()

const {
  vs, planRows, today, visibleDates, dateRangeLabel, viewOffset,
  textFilters, numFilters, sortState,
  editingKey, editForm,
  groupedRows, tableRows, vtStartIndex, vtVisibleCount, vtVisibleRows,
  importDialogVisible, importFile, importing, importMode, importPreview,
  load, saveActual, savePlanEdit, startEdit, cancelEdit, isEditing,
  onTextFilter, onNumFilter, onSort, isFilterActive,
  toggleCollapse, isCollapsed, groupRowCount,
  shiftWeek, scrollToTop, dateLabel,
  onImportFileChange, doImport, confirmImport, doExport,
} = useSecPlanDetail('template')

// [2026-06-20] supervisor 跨车间拦截:只能编辑本车间的 actual
const auth = useAuthStore()
function canEditActualCell(row) {
  return canEditActual({ ...row, secondary_type: 'template', workshop: 'template' }, auth.user)
}

// 新增排程
const createDialogVisible = ref(false)
const createForm = ref({ style_no: '', product_name: '', color: '', size_spec: '', plan_qty: 0, plan_start: '', daily_target: 0 })

function openCreate() {
  createForm.value = { style_no: '', product_name: '', color: '', size_spec: '', plan_qty: 0, plan_start: '', daily_target: 0 }
  // 起止日期默认今天
  createForm.value.plan_start = createForm.value.plan_start || todayLocal()
  createForm.value.plan_end = createForm.value.plan_end || todayLocal()
  createDialogVisible.value = true
}

async function createSchedule() {
  if (!createForm.value.style_no) { ElMessage.warning('请填写款号'); return }
  try {
    await api.confirmTemplatePlan({
        style_no: createForm.value.style_no,
        color: createForm.value.color,
        size_spec: createForm.value.size_spec,
        plan_start: createForm.value.plan_start,
        plan_end: createForm.value.plan_end,
        plan_qty: createForm.value.plan_qty,
        daily_target: createForm.value.daily_target,
      })
    createDialogVisible.value = false
    ElMessage.success('新增成功')
    await load()
  } catch (e) { ElMessage.error('新增失败: ' + (e.response?.data?.error || e.message)) }
}

// 重写 confirmImport 以支持 printing/template 各自的 confirmXxxPlan 流程
async function customConfirmImport() {
  if (!importPreview.value?.length) return
  importing.value = true
  try {
    
      // printing/template: N 次调 confirmXXXPlan
      for (const rec of importPreview.value) {
        await api.confirmTemplatePlan({
          style_no: rec['款号'], color: rec['颜色'], size_spec: rec['尺码'],
          plan_start: rec['模板开始'], plan_end: rec['模板结束'],
          plan_qty: rec['原单量'], daily_target: rec['模板日产量'],
        })
      }
      ElMessage.success(`导入完成: ${importPreview.value.length} 条`)
    importDialogVisible.value = false
    importPreview.value = null; importFile.value = null
    await load()
  } catch (e) { ElMessage.error('导入失败: ' + (e.response?.data?.error || e.message)) }
  importing.value = false
}
</script>
<template>
  <div class="template-detail">
    <div class="detail-header">
      <div class="header-left">
        <el-button text @click="router.back()"><span style="margin-right:4px">←</span> 返回</el-button>
      </div>
      <div class="header-nav">
        <span class="nav-arrows">
          <button class="nav-btn" @click="shiftWeek(-1)" title="前一周">◀</button>
          <button class="nav-btn today-btn" @click="viewOffset=0" title="回到今天">今天</button>
          <button class="nav-btn" @click="shiftWeek(1)" title="后一周">▶</button>
        </span>
        <span class="date-range-label">{{ dateRangeLabel }}</span>
      </div>
      <div class="header-actions">
        <el-button type="primary" @click="importDialogVisible = true">导入Excel</el-button>
        <el-button @click="doExport">导出Excel</el-button>
        <el-button type="success" @click="openCreate">+ 新增排程</el-button>
      </div>
    </div>

    <div v-if="!planRows.length" style="text-align:center;padding:60px;color:var(--text-tertiary)">
      暂无模板排程数据
      <div style="margin-top:12px;font-size:12px;color:var(--text-tertiary)">
        需要：1. 款式管理中有模板款式 2. 面料装柜清单存在该款式 3. 预排总计划有模板日期
      </div>
    </div>

    <div v-else :ref="el => vs.container.value = el" class="excel-wrap" @scroll="vs.onScroll">
      <table class="excel-table">
        <thead>
          <tr>
            <th class="fix" style="min-width:95px"><div class="col-header"><span>款号</span>
              <TextFilter :data="planRows" field="style_no" @filter="f => onTextFilter('style_no', f)"
                :sortField="sortState.field==='style_no' ? sortState.sortBy : ''" :sortDir="sortState.field==='style_no' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('style_no')" />
            </div></th>
            <th class="fix" style="min-width:120px"><div class="col-header"><span>品名</span>
              <TextFilter :data="planRows" field="product_name" @filter="f => onTextFilter('product_name', f)"
                :sortField="sortState.field==='product_name' ? sortState.sortBy : ''" :sortDir="sortState.field==='product_name' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('product_name')" />
            </div></th>
            <th class="fix" style="min-width:65px"><div class="col-header"><span>颜色</span>
              <TextFilter :data="planRows" field="color" @filter="f => onTextFilter('color', f)"
                :sortField="sortState.field==='color' ? sortState.sortBy : ''" :sortDir="sortState.field==='color' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('color')" />
            </div></th>
            <th class="fix" style="min-width:60px"><div class="col-header"><span>尺码</span>
              <TextFilter :data="planRows" field="size_spec" @filter="f => onTextFilter('size_spec', f)"
                :sortField="sortState.field==='size_spec' ? sortState.sortBy : ''" :sortDir="sortState.field==='size_spec' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('size_spec')" />
            </div></th>
            <th class="fix" style="min-width:70px"><div class="col-header"><span>原单量</span>
              <NumberFilter :data="planRows" field="order_qty" @filter="f => onNumFilter('order_qty', f)"
                :sortField="sortState.field==='order_qty' ? sortState.sortBy : ''" :sortDir="sortState.field==='order_qty' ? sortState.dir : 'asc'"
                @sort="e => onSort(e.field, e.sortBy, e.dir)" :active="isFilterActive('order_qty')" />
            </div></th>
            <th class="fix" style="min-width:70px"><div class="col-header"><span>合计</span></div></th>
            <th class="fix" style="min-width:50px"><div class="col-header"><span>类型</span></div></th>
            <th v-for="d in visibleDates" :key="d" class="date-th" :class="{ 'today-col': d === today }">{{ dateLabel(d) }}</th>
            <th class="fix" style="min-width:80px"><div class="col-header"><span>操作</span></div></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="vtStartIndex > 0" :style="{ height: (vtStartIndex * vs.rowHeight) + 'px' }">
            <td :colspan="8 + visibleDates.length" style="padding:0;border:0"></td>
          </tr>
          <template v-for="row in vtVisibleRows" :key="row._key">
            <tr v-if="row._type === 'summary'" class="row-plan collapsed-row" :class="{ 'group-start': row.firstOfGroup }">
              <td class="fix first-group">
                <span class="collapse-btn" @click="toggleCollapse(row.style_no)">▶</span>
                {{ row.style_no }}
              </td>
              <td class="fix first-group">{{ row.product_name }}</td>
              <td class="fix" colspan="2" style="text-align:left;color:var(--text-tertiary);font-size:12px">共 {{ groupRowCount(row.style_no) }} 条颜色尺码</td>
              <td class="fix num">{{ row.order_qty?.toLocaleString() }}</td>
              <td class="fix num sum-cell">{{ row.totalPlan?.toLocaleString() }}</td>
              <td class="fix type-label plan-label">汇总</td>
              <td v-for="d in visibleDates" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today }">{{ (row.dateMap[d] || {}).plan || '' }}</td>
              <td class="fix"></td>
            </tr>
            <tr v-else-if="row._type === 'plan'" class="row-plan" :class="{ 'group-start': row.firstOfGroup, 'editing-row': isEditing(row) }">
              <td class="fix" :class="{ 'first-group': row.firstOfGroup }">
                <span v-if="row.firstOfGroup" class="collapse-btn" @click="toggleCollapse(row.style_no)">▼</span>
                {{ row.firstOfGroup ? row.style_no : '' }}
              </td>
              <td class="fix" :class="{ 'first-group': row.firstOfGroup }">{{ row.firstOfGroup ? row.product_name : '' }}</td>
              <td class="fix">{{ row.color }}</td>
              <td class="fix">{{ row.size_spec }}</td>
              <td class="fix num">
                <template v-if="isEditing(row)"><input class="cell-inp" type="number" min="0" v-model.number="editForm.order_qty" style="width:60px" /></template>
                <template v-else>{{ row.order_qty?.toLocaleString() }}</template>
              </td>
              <td class="fix num sum-cell">{{ row.totalPlan?.toLocaleString() }}</td>
              <td class="fix type-label plan-label">计划</td>
              <td v-for="d in visibleDates" :key="'p'+d" class="cell-num" :class="{ 'today-col': d === today, 'editable-cell': isEditing(row) }">
                <template v-if="isEditing(row)"><input class="cell-inp" type="number" min="0" v-model.number="editForm.datePlans[d]" /></template>
                <template v-else>{{ (row.dateMap[d] || {}).plan || '' }}</template>
              </td>
              <td class="fix">
                <template v-if="isEditing(row)">
                  <el-button size="small" text type="primary" @click="savePlanEdit(row)">保存</el-button>
                  <el-button size="small" text @click="cancelEdit">取消</el-button>
                </template>
                <template v-else>
                  <el-button size="small" text type="primary" @click="startEdit(row)">编辑</el-button>
                </template>
              </td>
            </tr>
            <tr v-else-if="row._type === 'actual'" class="row-actual">
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix num sum-cell">{{ row.totalActual?.toLocaleString() }}</td>
              <td class="fix type-label actual-label">实际</td>
              <td v-for="d in visibleDates" :key="'a'+d" class="cell-num editable-cell" :class="{ 'today-col': d === today }">
                <input v-if="canEditActualCell(row)" class="cell-inp" type="number" min="0"
                  :value="(row.dateMap[d] || {}).actual || ''"
                  @change="e => {
                    const dd = row.dateMap[d]
                    if (dd) { dd.actual = parseInt(e.target.value) || 0 }
                    saveActual(row, d)
                  }" />
                <span v-else>{{ (row.dateMap[d] || {}).actual || '' }}</span>
              </td>
              <td class="fix"></td>
            </tr>
            <tr v-else class="row-diff">
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix"></td>
              <td class="fix num sum-cell" :class="{ 'diff-pos': row.totalDiff > 0, 'diff-neg': row.totalDiff < 0 }">{{ row.totalDiff > 0 ? '+' : '' }}{{ row.totalDiff?.toLocaleString() }}</td>
              <td class="fix type-label diff-label">差异</td>
              <td v-for="d in visibleDates" :key="'f'+d" class="cell-num" :class="{ 'today-col': d === today }">
                <span :class="{ 'diff-pos': (row.dateMap[d] || {}).diff > 0, 'diff-neg': (row.dateMap[d] || {}).diff < 0 }">
                  {{ (row.dateMap[d] || {}).diff > 0 ? '+' + (row.dateMap[d] || {}).diff : (row.dateMap[d] || {}).diff || '' }}
                </span>
              </td>
              <td class="fix"></td>
            </tr>
          </template>
          <tr v-if="(vtStartIndex + vtVisibleRows.length) < tableRows.length" :style="{ height: ((tableRows.length - vtStartIndex - vtVisibleRows.length) * vs.rowHeight) + 'px' }">
            <td :colspan="8 + visibleDates.length" style="padding:0;border:0"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="scroll-top-btn" @click="scrollToTop">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4L4 12h12L10 4z" fill="#fff"/></svg>
    </div>
    <div class="data-source-hint">数据来源：基础数据/款式管理 → 面料装柜清单 → 分色分尺码 → 预排总计划</div>

    <el-dialog v-model="createDialogVisible" title="新增模板排程" width="520px">
    <el-form :model="createForm" label-width="90px" size="small">
      <el-row :gutter="12"><el-col :span="12"><el-form-item label="款号"><el-input v-model="createForm.style_no" /></el-form-item></el-col><el-col :span="12"><el-form-item label="颜色"><el-input v-model="createForm.color" /></el-form-item></el-col></el-row><el-row :gutter="12"><el-col :span="12"><el-form-item label="尺码"><el-input v-model="createForm.size_spec" /></el-form-item></el-col><el-col :span="12"><el-form-item label="原单量"><el-input-number v-model="createForm.plan_qty" :min="1" :step="1" style="width:100%" /></el-form-item></el-col></el-row><el-row :gutter="12"><el-col :span="12"><el-form-item label="模板上线"><el-input v-model="createForm.plan_start" type="date" /></el-form-item></el-col><el-col :span="12"><el-form-item label="模板日产量"><el-input-number v-model="createForm.daily_target" :min="1" :step="100" style="width:100%" /></el-form-item></el-col></el-row>
    </el-form>
    <template #footer>
      <el-button @click="createDialogVisible=false">取消</el-button>
      <el-button type="primary" @click="createSchedule">创建</el-button>
    </template>
  </el-dialog>

    <el-dialog v-model="importDialogVisible" title="导入Excel" width="600px">
      <div style="margin-bottom:12px">
        <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" />
        <span v-if="importFile" style="margin-left:8px;color:var(--primary-dark)">{{ importFile.name }}</span>
      </div>
      <div v-if="importFile" style="margin-bottom:12px">
        <el-button @click="doImport" type="primary" :loading="importing">解析预览</el-button>
        <el-radio-group v-model="importMode" style="margin-left:12px">
          <el-radio value="skip">跳过重复</el-radio>
          <el-radio value="overwrite">覆盖已有</el-radio>
        </el-radio-group>
      </div>
      <div v-if="importPreview?.length" style="max-height:300px;overflow:auto">
        <div style="margin-bottom:4px;font-size:12px;color:var(--text-secondary)">共 {{ importPreview.length }} 条</div>
        <el-table :data="importPreview" size="small" border max-height="220">
          <el-table-column label="款号" width="100"><template #default="{ row }">{{ row['款号'] }}</template></el-table-column>
          <el-table-column label="颜色" width="60"><template #default="{ row }">{{ row['颜色'] }}</template></el-table-column>
          <el-table-column label="尺码" width="60"><template #default="{ row }">{{ row['尺码'] }}</template></el-table-column>
          <el-table-column label="日期" width="95"><template #default="{ row }">{{ row.production_date || row['日期'] }}</template></el-table-column>
          <el-table-column label="数量" width="60"><template #default="{ row }">{{ row.completed_qty || row['数量'] }}</template></el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="customConfirmImport" :loading="importing" :disabled="!importPreview?.length">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.template-detail { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); gap: 12px; flex-shrink: 0; }
.header-left { display: flex; align-items: center; flex-shrink: 0; }
.header-nav { display: flex; align-items: center; gap: 8px; justify-content: center; flex: 1; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }
.data-source-hint { font-size: 11px; color: var(--text-tertiary); background: var(--bg); padding: 4px 8px; border-radius: var(--radius-sm); }

.nav-arrows { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.nav-btn {
  padding: 6px 12px; background: var(--primary); color: #fff; border: none;
  border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; font-weight: 500;
  transition: var(--transition); line-height: 1; white-space: nowrap; flex-shrink: 0;
}
.nav-btn:hover { background: var(--primary-dark); }
.nav-btn.today-btn { font-weight: 600; padding: 6px 14px; }
.date-range-label { font-size: 14px; font-weight: 600; color: var(--text); min-width: 120px; text-align: center; margin-left: 4px; white-space: nowrap; }

.excel-wrap { flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
.excel-wrap.dragging, .excel-wrap.dragging td, .excel-wrap.dragging th { user-select: none !important; }

.excel-table { border-collapse: collapse; font-size: 13px; color: var(--text); min-width: 100%; }
.excel-table thead th {
  padding: 0; background: var(--card); color: var(--text-tertiary); font-size: 11px; font-weight: 500;
  letter-spacing: 0.3px; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap;
  position: sticky; top: 0; z-index: 3;
}
.excel-table td { padding: 10px 14px; border-bottom: 1px solid var(--border-light); white-space: nowrap; text-align: center; }
.excel-table td:nth-child(1), .excel-table td:nth-child(2), .excel-table td:nth-child(3) { text-align: left; }
.excel-table th:nth-child(1), .excel-table th:nth-child(2), .excel-table th:nth-child(3) { text-align: left; }
.col-header { display: flex; flex-direction: row; align-items: center; justify-content: flex-start; padding: 10px 14px; gap: 4px; }
.col-header span { font-weight: 500; font-size: 11px; flex-shrink: 0; color: var(--text-tertiary); letter-spacing: 0.3px; }

.row-plan { background: #f5f0ff; }
.row-actual { background: #f0fff4; }
.row-diff { background: #fffaf0; }
.row-diff td { border-bottom: 2px solid var(--border); }
.first-group td { border-top: 2px solid var(--primary); }
.collapse-btn { cursor: pointer; user-select: none; margin-right: 4px; font-size: 10px; color: var(--text-tertiary); transition: color 0.15s; }
.collapse-btn:hover { color: var(--primary); }
.collapsed-row { background: #f8f5ff !important; opacity: 0.85; }
.collapsed-row .fix { background: #f8f5ff !important; }

tbody tr:hover td:not(.fix) { background: var(--primary-light); }
.fix { position: sticky; left: 0; z-index: 1; background: inherit; }
.row-plan .fix { background: #f5f0ff; }
.row-actual .fix { background: #f0fff4; }
.row-diff .fix { background: #fffaf0; }
.excel-table thead .fix { z-index: 4; background: var(--card); }

.date-th { min-width: 50px; width: 50px; }
.excel-table .today-col { background: #e0d4ff !important; box-shadow: inset 3px 0 0 var(--primary); text-align: center !important; }
.excel-table thead .today-col { background: #e0d4ff !important; color: var(--primary) !important; font-weight: 700 !important; }
.num { text-align: center !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }
.sum-cell { font-weight: 700; }
.type-label { font-weight: 600; font-size: 12px; }
.plan-label { color: #7c3aed; }
.actual-label { color: #059669; }
.diff-label { color: #d97706; }
.diff-pos { color: #059669; font-weight: 600; }
.diff-neg { color: #dc2626; font-weight: 600; }
.cell-num { text-align: center !important; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', Arial, sans-serif; }
.editable-cell { padding: 2px 4px !important; }
.cell-inp {
  width: 48px; padding: 4px 6px; border: 1px solid transparent; border-radius: 4px;
  text-align: center; font-size: 13px; font-variant-numeric: tabular-nums;
  font-family: 'Helvetica Neue', Arial, sans-serif; background: transparent;
  transition: border-color 0.15s;
}
.cell-inp:hover { border-color: var(--border); }
.cell-inp:focus { border-color: var(--primary); outline: none; background: #fff; }
.editing-row td { background: var(--primary-light) !important; box-shadow: inset 3px 0 0 var(--primary); }
.editing-row .fix { background: var(--primary-light) !important; }
.scroll-top-btn {
  position: fixed; bottom: 24px; right: 24px; width: 44px; height: 44px;
  border-radius: 50%; background: var(--primary); cursor: pointer;
  box-shadow: var(--shadow-md); z-index: 100; transition: var(--transition);
  display: flex; align-items: center; justify-content: center;
}
.scroll-top-btn:hover { background: var(--primary-hover); }
</style>
