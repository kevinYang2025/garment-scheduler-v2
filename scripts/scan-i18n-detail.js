// 列出当前缺失的所有中文短语 + 出现位置
const fs = require('node:fs')
const path = require('node:path')
const SRC_DIR = path.resolve(__dirname, '..')
const { glob } = require('node:fs/promises')

;(async () => {
  const dict = {}
  const i18nContent = fs.readFileSync(path.join(SRC_DIR, 'garment-web/src/i18n.js'), 'utf8')
  const dictRegex = /'([\w.]+)':\s*\{\s*zh:\s*'([^']+)'/g
  let m
  while ((m = dictRegex.exec(i18nContent)) !== null) {
    dict[m[2]] = m[1]
  }
  const missing = new Map()  // text → [{file, line}]
  const elRegex = /ElMessage\.\w+\(\s*['"]([^'"]*[\u4e00-\u9fa5][^'"]*)['"]/g
  for await (const file of glob('garment-web/src/**/*.{vue,js}', { cwd: SRC_DIR })) {
    const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf8')
    const lines = content.split('\n')
    let textInLine
    while ((textInLine = elRegex.exec(content)) !== null) {
      const text = textInLine[1]
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
        // 找行号
        let lineNo = 0
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(textInLine[0])) { lineNo = i + 1; break }
        }
        if (!missing.has(text)) missing.set(text, [])
        missing.get(text).push(`${file}:${lineNo}`)
      }
    }
  }
  console.log(`缺失 ${missing.size} 条:`)
  for (const [t, locs] of [...missing.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${locs.length}× ${t}  (${locs[0]})`)
  }
})()