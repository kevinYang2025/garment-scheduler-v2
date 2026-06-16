const XLSX = require('xlsx');
const http = require('http');
const path = require('path');

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node import-scs.js <xlsx-path>'); process.exit(1); }

console.log('Reading:', filePath);
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

const headers = rows[0];
const headerMap = {
  '订单日期': 'order_date', '款式': 'style_no', '交期': 'due_date',
  '产品名': 'product_name', '规格': 'size_spec', '颜色': 'color', '原单量': 'plan_qty',
};
const colMap = {};
headers.forEach((h, i) => { if (headerMap[h]) colMap[i] = headerMap[h] });

const records = [];
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || row.every(c => c == null)) continue;
  const item = {};
  for (const [col, key] of Object.entries(colMap)) {
    let val = row[Number(col)];
    if (val instanceof Date) {
      item[key] = `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
    } else {
      item[key] = val != null ? String(val).trim() : '';
    }
  }
  if (item.style_no) records.push(item);
}

console.log(`Parsed ${records.length} records`);

const postData = JSON.stringify({ records });
const options = {
  hostname: 'localhost', port: 3001, path: '/api/style-color-size/import',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('Response:', body);
    process.exit(0);
  });
});
req.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
req.write(postData);
req.end();
