<template>
  <div class="sewing-dispatch-home">
    <div class="sdh-header">
      <h2 class="sdh-title" style="white-space: pre-line">{{ t('nav.sewingDispatch') }}</h2>
      <p class="sdh-desc" style="white-space: pre-line">{{ t('sewingDispatch.selectDesc') }}</p>
    </div>
    <div class="sdh-grid">
      <div
        v-for="ws in workshops"
        :key="ws"
        class="sdh-card"
        @click="$router.push({ name: 'sewing-dispatch-detail', query: { workshop: ws } })"
      >
        <div class="sdh-card-icon">🏭</div>
        <div class="sdh-card-name">{{ ws }}</div>
        <div class="sdh-card-arrow">→</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from '../composables/useI18n'
const { t } = useI18n()
// 缝制报工选车间页(Step 6 再按角色过滤)
const workshops = ['一车间', '二车间', '三车间', '四车间', '五车间']
</script>

<style scoped>
.sewing-dispatch-home { max-width: 800px; padding: 40px 20px; }
.sdh-header { text-align: center; margin-bottom: 40px; }
.sdh-title { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 6px; }
.sdh-desc { font-size: 14px; color: #6b7280; }
.sdh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
.sdh-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 32px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}
.sdh-card:hover {
  border-color: #6e3ff3;
  box-shadow: 0 4px 16px rgba(110, 63, 243, 0.1);
  transform: translateY(-2px);
}
.sdh-card-icon { font-size: 36px; margin-bottom: 12px; }
.sdh-card-name { font-size: 16px; font-weight: 600; color: #111827; }
.sdh-card-arrow {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 18px;
  color: #a1a1aa;
  opacity: 0;
  transition: opacity 0.2s;
}
.sdh-card:hover .sdh-card-arrow { opacity: 1; color: #6e3ff3; }
</style>
