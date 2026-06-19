// [2026-06-19] 中柬双语 语言 store
// 'both' (默认): 中文+高棉文并列
// 'zh': 只中文
// 'km': 只高棉文
import { defineStore } from 'pinia'

const STORAGE_KEY = 'garment.lang'

export const useLangStore = defineStore('lang', {
  state: () => ({
    mode: localStorage.getItem(STORAGE_KEY) || 'both',  // 'zh' | 'km' | 'both'
  }),
  actions: {
    setMode(m) {
      this.mode = m
      localStorage.setItem(STORAGE_KEY, m)
    },
    toggle() {
      // both → zh → km → both
      if (this.mode === 'both') this.setMode('zh')
      else if (this.mode === 'zh') this.setMode('km')
      else this.setMode('both')
    },
  },
})