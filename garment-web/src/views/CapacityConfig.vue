<script setup>
const props = defineProps({ db: Object })
</script>

<template>
  <div class="settings-page">
    <div class="empty-state">
      <div class="empty-icon">⚙️</div>
      <p>设置功能开发中...</p>
      <p class="empty-hint">未来将支持用户账户、权限管理、系统参数等配置</p>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 900px;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--text-tertiary);
  gap: 12px;
}
.empty-icon { font-size: 48px; }
.empty-state p { font-size: 14px; }
.empty-hint { font-size: 12px; color: var(--text-tertiary); }
</style>
