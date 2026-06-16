const Database = require('better-sqlite3')
const ExcelJS = require('exceljs')
const path = require('path')

async function main() {
  const db = new Database(path.join(__dirname, 'data.sqlite'))
  db.pragma('journal_mode = WAL')

  // 1. 清空旧数据
  db.prepare('DELETE FROM styles').run()
  console.log('已清空 styles 表')

  // 2. 读取 Excel
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(__dirname, '基础数据.xlsx'))
  const ws = wb.worksheets[0]

  // 3. 日期处理
  function fmtDate(v) {
    if (!v) return ''
    // ExcelJS Date object
    if (v instanceof Date) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    }
    // Excel serial number
    if (typeof v === 'number' && v > 40000) {
      const ms = (v - 25569) * 86400000
      const d = new Date(ms)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    // String that looks like a date already
    const s = String(v).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    return s
  }

  // 4. 逐行插入
  const stmt = db.prepare(`INSERT INTO styles
    (style_no, product_name, fabric_code, plan_qty, due_date, order_date,
     embroidery, embroidery_daily_output, printing, printing_daily_output,
     ironing_label, ironing_daily_output, template, template_daily_output,
     tt_time, target_daily_output, remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)

  let count = 0
  const txn = db.transaction(() => {
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i)
      const g = (c) => {
        let v = row.getCell(c).value
        if (v && typeof v === 'object' && v.result !== undefined) v = v.result
        return v != null ? String(v).trim() : ''
      }
      const style_no = g(2)
      if (!style_no) continue

      const order_date = fmtDate(row.getCell(1).value)
      const plan_qty = parseInt(g(5)) || 0
      const due_date = fmtDate(row.getCell(6).value)
      const embroidery = g(7)
      const embroidery_daily_output = parseInt(g(8)) || 0
      const printing = g(9)
      const printing_daily_output = parseInt(g(10)) || 0
      const ironing_label = g(11)
      const ironing_daily_output = parseInt(g(12)) || 0
      const template = g(13)
      const template_daily_output = parseInt(g(14)) || 0
      const tt_time = g(15)
      const target_daily_output = parseInt(g(16)) || 0
      const remarks = g(17)

      stmt.run(
        style_no, g(3), g(4), plan_qty, due_date, order_date,
        embroidery, embroidery_daily_output, printing, printing_daily_output,
        ironing_label, ironing_daily_output, template, template_daily_output,
        tt_time, target_daily_output, remarks
      )
      count++
    }
  })
  txn()
  console.log(`导入完成: ${count} 条`)
  db.close()
}

main().catch(console.error)
