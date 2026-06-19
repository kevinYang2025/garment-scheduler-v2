// [2026-06-19] i18n composable
// 用法:
//   import { useI18n } from '@/composables/useI18n'
//   const { t, mode, setMode } = useI18n()
//   t('nav.home')  // '工作台\nទំព័រដើម'  (默认 both)
//   t('nav.home', 'zh')  // '工作台'
//   t('nav.home', 'km')  // 'ទំព័រដើម'
//   t('user.resetPwdDesc', null, { name: '张三', user: '101' })  // 占位符
import { computed } from 'vue'
import { useLangStore } from '../stores/lang'
import { t as it } from '../i18n'

export function useI18n() {
  const lang = useLangStore()
  const mode = computed(() => lang.mode)

  function t(key, forceMode, params) {
    return it(key, forceMode || lang.mode, params)
  }

  function setMode(m) {
    lang.setMode(m)
  }

  return { t, mode, setMode, lang }
}