import { ref, onMounted, onActivated, onUnmounted } from 'vue'

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
    if (!isScrolling) isScrolling = true
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => { isScrolling = false }, 100)
    if (raf) return
    raf = requestAnimationFrame(() => {
      scrollTop.value = e.target.scrollTop
      raf = null
    })
  }

  function debouncedResize(height) {
    if (isScrolling) return
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { containerHeight.value = height }, 32)
  }

  function onWindowResize() {
    if (container.value) {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        containerHeight.value = container.value.clientHeight
      }, 50)
    }
  }

  function attachObserver() {
    if (!container.value) return
    containerHeight.value = container.value.clientHeight || containerHeight.value
    if (ro) ro.disconnect()
    ro = new ResizeObserver(([entry]) => { debouncedResize(entry.contentRect.height) })
    ro.observe(container.value)
  }

  onMounted(() => {
    attachObserver()
    window.addEventListener('resize', onWindowResize, { passive: true })
  })
  // [2026-06-18] KeepAlive 切回时 onMounted 不再触发,补 onActivated 重挂 ResizeObserver
  onActivated(() => { attachObserver() })
  onUnmounted(() => {
    if (raf) cancelAnimationFrame(raf)
    clearTimeout(resizeTimer)
    clearTimeout(scrollTimer)
    if (ro) ro.disconnect()
    window.removeEventListener('resize', onWindowResize)
  })

  return {
    container,
    scrollTop,
    containerHeight,
    onScroll,
    rowHeight,
    bufferRows,
  }
}
