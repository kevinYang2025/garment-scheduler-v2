<template>
  <div class="forbidden-page">
    <el-result icon="warning" title="403 无权访问" sub-title="你当前的角色无权访问该页面">
      <template #extra>
        <el-button type="primary" @click="$router.push('/')">返回首页</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup>
// [2026-06-20] 用户系统:403 无权访问页(替代之前跳 /?forbidden=1 静默体验)
</script>

<style scoped>
.forbidden-page {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>