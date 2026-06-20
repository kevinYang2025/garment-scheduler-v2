<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { formatLocal as fmtLocal } from '../utils/date'

const plans = ref([])
const loading = ref(true)
const generating = ref(false)

const showCreateDialog = ref(false)
const createForm = ref({ plan_no: '', customer: '', style_no: '', product_name: '', plan_qty: 0, ship_date: '' })

const statusColors = { PLANNED: 'info', SHIPPED: 'success', CANCELLED: 'danger' }
const statusLabels = { PLANNED: '待出货', SHIPPED: '已出货', CANCELLED: '已取消' }

async function loadPlans() {
  loading.value = true
  try {
    const { data } = await api.getShippingPlans()
    plans.value = data || []
  } catch { ElMessage.error('加载出货计划失败') }
  loading.value = false
}

async function savePlan() {
  try {
    await api.createShippingPlan(createForm.value)
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    await loadPlans()
  } catch { ElMessage.error('创建失败') }
}

async function deletePlan(id) {
  try {
    await ElMessageBox.confirm('确定删除？')
    await api.deleteShippingPlan(id)
    await loadPlans()
  } catch {}
}

async function generateFromMainPlan() {
  generating.value = true
  try {
    const { data } = await api.generateShippingPlans()
    ElMessage.success(`自动生成 ${data.count} 条出货计划`)
    await loadPlans()
  } catch { ElMessage.error('生成失败') }
  generating.value = false
}

async function updateStatus(id, status) {
  try {
    const plan = plans.value.find(p => p.id === id)
    if (!plan) return
    await api.updateShippingPlan(id, { ...plan, status })
    await loadPlans()
  } catch {}
}

function openCreate() {
  const today = fmtLocal(new Date())
  const seq = String(plans.value.length + 1).padStart(3, '0')
  createForm.value = { plan_no: `SP-${today.replace(/-/g,'')}-${seq}`, customer: '', style_no: '', product_name: '', plan_qty: 0, ship_date: '' }
  showCreateDialog.value = true
}

onMounted(loadPlans)
</script>

<template>
  <div class="shipping-page">
    <div class="page-header-bar">
      <h2 class="page-heading">出货计划</h2>
      <div style="display:flex;gap:8px">
        <el-button type="primary" @click="generateFromMainPlan" :loading="generating">从预排总计划自动生成</el-button>
        <el-button @click="openCreate">手动新建</el-button>
      </div>
    </div>

    <el-table :data="plans" v-loading="loading" stripe size="small">
      <el-table-column prop="plan_no" label="计划编号" width="160" />
      <el-table-column prop="customer" label="客户" width="100" />
      <el-table-column prop="style_no" label="款号" width="150" show-overflow-tooltip />
      <el-table-column prop="product_name" label="品名" width="120" show-overflow-tooltip />
      <el-table-column prop="plan_qty" label="数量" width="80" align="right" />
      <el-table-column prop="ship_date" label="出货日期" width="110" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusColors[row.status]" size="small">{{ statusLabels[row.status] || row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button v-if="row.status === 'PLANNED'" size="small" text type="success" @click="updateStatus(row.id, 'SHIPPED')">标记出货</el-button>
          <el-button v-if="row.status === 'PLANNED'" size="small" text type="danger" @click="updateStatus(row.id, 'CANCELLED')">取消</el-button>
          <el-button size="small" text type="danger" @click="deletePlan(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreateDialog" title="新建出货计划" width="500px">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="计划编号"><el-input v-model="createForm.plan_no" /></el-form-item>
        <el-form-item label="客户"><el-input v-model="createForm.customer" /></el-form-item>
        <el-form-item label="款号"><el-input v-model="createForm.style_no" /></el-form-item>
        <el-form-item label="品名"><el-input v-model="createForm.product_name" /></el-form-item>
        <el-form-item label="数量"><el-input-number v-model="createForm.plan_qty" :min="0" style="width:100%" /></el-form-item>
        <el-form-item label="出货日期"><el-input v-model="createForm.ship_date" type="date" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="savePlan">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.shipping-page { max-width: 1100px; }
.page-header-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-heading { font-size: 20px; font-weight: 700; }
</style>
