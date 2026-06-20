// 调试: 输出 scan 全部 56 (或 9) 个缺失 key
const fs = require('node:fs')
const path = require('node:path')
const SRC_DIR = path.resolve(__dirname, '..')
;(async () => {
  const dict = {}
  const i18nContent = fs.readFileSync(path.join(SRC_DIR, 'garment-web/src/i18n.js'), 'utf8')
  const dictRegex = /'([\w.]+)':\s*\{\s*zh:\s*'([^']+)'/g
  let m
  while ((m = dictRegex.exec(i18nContent)) !== null) {
    dict[m[2]] = m[1]
  }
  const { glob } = require('node:fs/promises')
  const missing = new Map()
  const elRegex = /ElMessage\.\w+\(\s*['"]([^'"]*[\u4e00-\u9fa5][^'"]*)['"]/g
  for await (const file of glob('garment-web/src/**/*.{vue,js}', { cwd: SRC_DIR })) {
    const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf8')
    let em
    while ((em = elRegex.exec(content)) !== null) {
      let text = em[1]
      if (/\{[a-zA-Z]+\}/.test(text)) continue
      let matched = !!dict[text]
      if (!matched) {
        const trimmed = text.replace(/[:\s]+$/, '')
        for (const zhText of Object.keys(dict)) {
          if (zhText === trimmed || zhText === text || zhText.startsWith(trimmed + ':')) {
            matched = true
            break
          }
        }
      }
      if (!matched) {
        missing.set(text, (missing.get(text) || 0) + 1)
      }
    }
  }
  console.log(`缺失 ${missing.size} 条:`)
  for (const [t, c] of [...missing.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}× ${JSON.stringify(t)}`)
  }
})()