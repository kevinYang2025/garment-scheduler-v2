<template>
  <div class="ring-progress" :style="{ '--ring-color': color }">
    <svg :width="size" :height="size" viewBox="0 0 100 100">
      <circle cx="50" cy="50" :r="radius" class="ring-bg" />
      <circle
        cx="50"
        cy="50"
        :r="radius"
        class="ring-fg"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        transform="rotate(-90 50 50)"
      />
    </svg>
    <div class="ring-center">
      <div class="ring-percent">{{ percent }}%</div>
      <div v-if="label" class="ring-label">{{ label }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  percent: { type: Number, default: 0 },
  label:   { type: String, default: '' },
  color:   { type: String, default: '#6e3ff3' },
  size:    { type: Number, default: 160 },
  strokeWidth: { type: Number, default: 8 }
})

const radius = computed(() => 50 - props.strokeWidth / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const dashOffset = computed(() => circumference.value * (1 - props.percent / 100))
</script>

<style scoped>
.ring-progress {
  position: relative;
  display: inline-block;
}
.ring-bg {
  fill: none;
  stroke: #f3f0ff;
  stroke-width: 8;
}
.ring-fg {
  fill: none;
  stroke: var(--ring-color);
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.6s ease;
}
.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.ring-percent {
  font-size: 28px;
  font-weight: 800;
  color: var(--ring-color);
  line-height: 1;
}
.ring-label {
  margin-top: 6px;
  font-size: 10px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  text-align: center;
  max-width: 80%;
}
</style>
