// [2026-06-20 fix#业务-P3-3] i18n 扫描脚本
// 扫 garment-web/src/**/*.vue 找直接写的中文 ElMessage 字符串,
// 跟 i18n.js dict 比对,输出缺失的 key 数量和建议补的内容
// 用法: node scripts/scan-i18n.js
const fs = require('node:fs')
const path = require('node:path')
const { glob } = require('node:fs/promises')

const SRC_DIR = path.resolve(__dirname, '..')
const VUE_GLOB = 'garment-web/src/**/*.{vue,js}'

;(async () => {
  const dict = {}
  const i18nContent = fs.readFileSync(path.join(SRC_DIR, 'garment-web/src/i18n.js'), 'utf8')
  // 提取所有 key: 'common.success': { zh: '成功', ... }
  const dictRegex = /'([\w.]+)':\s*\{\s*zh:\s*'([^']+)'/g
  let m
  while ((m = dictRegex.exec(i18nContent)) !== null) {
    dict[m[2]] = m[1]
  }

  const allFiles = []
  for await (const file of glob(VUE_GLOB, { cwd: SRC_DIR })) {
    allFiles.push(file)
  }

  const missing = new Map()  // 中文短语 → 出现次数
  const elRegex = /ElMessage\.\w+\(\s*['"]([^'"]*[\u4e00-\u9fa5][^'"]*)['"]/g
  let total = 0
  let translated = 0
  for (const file of allFiles) {
    const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf8')
    let em
    while ((em = elRegex.exec(content)) !== null) {
      let text = em[1]
      total++
      // 跳过带 {xx} 占位符的(复杂消息单独处理)
      if (/\{[a-zA-Z]+\}/.test(text)) { translated++; continue }
      // 字面量 '导入失败: ' 视为模板 '导入失败: {msg}' 的特例(代码里 + 拼接)
      // 即:去掉尾部 ' ' 或 ': ' 后查表,匹配则视为已翻译
      let matched = !!dict[text]
      if (!matched) {
        const trimmed = text.replace(/[:\s]+$/, '')
        // 字典里有 '导入失败: {msg}' 的话也算(忽略占位符差异)
        for (const [zhText, key] of Object.entries(dict)) {
          if (zhText === trimmed || zhText === text || zhText.startsWith(trimmed + ':')) {
            matched = true
            break
          }
        }
      }
      if (matched) {
        translated++
      } else {
        missing.set(text, (missing.get(text) || 0) + 1)
      }
    }
  }

  console.log(`扫描 ${allFiles.length} 个文件`)
  console.log(`ElMessage 中文本: ${total} 条`)
  console.log(`已 i18n 化: ${translated} 条`)
  console.log(`缺失: ${missing.size} 条`)
  console.log('---')
  const sorted = [...missing.entries()].sort((a, b) => b[1] - a[1])
  for (const [text, count] of sorted) {
    console.log(`${count.toString().padStart(3)}× ${text}`)
  }
})()