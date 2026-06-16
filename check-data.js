const db = require('./garment-server/db');
db.init();
const g = db.getDb();

const printingStyles = g.prepare("SELECT id, style_no, printing, printing_daily_output FROM styles WHERE printing = '是'").all();
console.log('printing styles:', JSON.stringify(printingStyles, null, 2));

const colorSizeCount = g.prepare('SELECT COUNT(*) as c FROM style_color_size').get();
console.log('style_color_size count:', colorSizeCount);

const mainPlanPrinting = g.prepare("SELECT style_no, printing_start, printing_end FROM main_plan WHERE printing_start IS NOT NULL AND printing_start != '' LIMIT 5").all();
console.log('main_plan with printing_start:', JSON.stringify(mainPlanPrinting, null, 2));

const schedulePrinting = g.prepare("SELECT COUNT(*) as c FROM schedule_master WHERE schedule_type='secondary' AND secondary_type='printing'").get();
console.log('schedule_master printing count:', schedulePrinting);

// Check what styles exist
const allStyles = g.prepare("SELECT id, style_no, printing FROM styles LIMIT 10").all();
console.log('all styles (first 10):', JSON.stringify(allStyles, null, 2));

// Check main_plan fields
const mainPlanSample = g.prepare("SELECT style_no, printing_start, printing_end, sewing_start, sewing_end FROM main_plan LIMIT 3").all();
console.log('main_plan sample:', JSON.stringify(mainPlanSample, null, 2));
