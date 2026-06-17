// 公共虚拟滚动 composable
// 用法：
//   const vs = useVirtualScroll(36, 8)
//   const totalHeight = computed(() => rows.value.length * vs.rowHeight)
//   const startIndex = computed(() => Math.max(0, Math.floor(vs.scrollTop.value / vs.rowHeight) - vs.bufferRows))
//   const visibleCount = computed(() => Math.ceil(vs.containerHeight.value / vs.rowHeight) + vs.bufferRows * 2)
//   const visibleRows = computed(() => rows.value.slice(startIndex.value, startIndex.value + visibleCount.value))
//   const offsetY = computed(() => startIndex.value * vs.rowHeight)
//
//   <div ref="vs.container" class="vt-container" @scroll="vs.onScroll">
//     <table>
//       <tr v-if="startIndex > 0" :style="{ height: (startIndex * vs.rowHeight) + 'px' }"><td colspan="..."></td></tr>
//       <tr v-for="row in visibleRows" :key="row._key">...</tr>
//       <tr v-if="(startIndex + visibleRows.length) < rows.length" :style="{ height: ((rows.length - startIndex - visibleRows.length) * vs.rowHeight) + 'px' }"></td></tr>
//     </table>
//   </div>
import { ref, onMounted, onUnmounted } from 'vue'

export function useVirtualScroll(rowHeight = 36, bufferRows = 8) {
  const container = ref(null)
  const scrollTop = ref(0)
  const containerHeight = ref(600)
  let raf = null
  let ro = null
  let resizeTimer = null
  let isScrolling = false
  let scrollTimer = null

  function onScroll(e) {
    // 标记滚动中，冻结 ResizeObserver 更新
    if (!isScrolling) {
      isScrolling = true
    }
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => {
      isScrolling = false
    }, 100)

    // requestAnimationFrame 节流：scroll 事件最高频率会被合并到每帧 1 次
    if (raf) return
    raf = requestAnimationFrame(() => {
      scrollTop.value = e.target.scrollTop
      raf = null
    })
  }

  function debouncedResize(height) {
    // 滚动期间冻结容器高度更新，防止抖动循环
    if (isScrolling) return
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      containerHeight.value = height
    }, 32) // 两帧延迟，完全防抖
  }

  function onWindowResize() {
    if (container.value) {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        containerHeight.value = container.value.clientHeight
      }, 50)
    }
  }

  onMounted(() => {
    if (container.value) {
      containerHeight.value = container.value.clientHeight
      ro = new ResizeObserver(([entry]) => {
        debouncedResize(entry.contentRect.height)
      })
      ro.observe(container.value)
      window.addEventListener('resize', onWindowResize, { passive: true })
    }
  })
  onUnmounted(() => {
    if (raf) cancelAnimationFrame(raf)
    clearTimeout(resizeTimer)
    clearTimeout(scrollTimer)
    if (ro) ro.disconnect()
    window.removeEventListener('resize', onWindowResize)
  })

  return {
    container,        // ref — 绑定到滚动容器
    scrollTop,        // ref<number> — 当前 scrollTop
    containerHeight,  // ref<number> — 容器高度（响应式）
    onScroll,         // function — 绑定到 @scroll
    rowHeight,        // number — 每行像素
    bufferRows,       // number — 上下额外渲染行数
  }
}
