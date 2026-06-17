// 二次加工类型常量(I-01 fix)
// 后端 SECONDARY_TYPES / 前端 dispatch 视图共用同一套表达
//   key     → URL/API 路径段
//   name    → 短中文名(用于后端 secondary_type 字段值,如 '印花')
//   title   → 长中文名(用于 UI 标题,如 '印花报工')
//   icon    → UI 图标
//   api     → api/index.js 的方法名
export const SECONDARY_TYPES = {
  printing:   { name: '印花', title: '印花报工', icon: '🎨', api: 'getPrintingDailyPlan'   },
  embroidery: { name: '刺绣', title: '刺绣报工', icon: '🧵', api: 'getEmbroideryDailyPlan' },
  template:   { name: '模板', title: '模板报工', icon: '📐', api: 'getTemplateDailyPlan'   },
  ironing:    { name: '烫标', title: '烫标报工', icon: '🔥', api: 'getIroningDailyPlan'    },
};

export const SECONDARY_TYPE_KEYS = Object.keys(SECONDARY_TYPES);

export function getSecondaryTypeConfig(key) {
  return SECONDARY_TYPES[key] || SECONDARY_TYPES.printing;
}

// styles 表里 secondary 标志字段:是/否
// 后端 styles 字段: embroidery / printing / ironing_label / template
export const STYLE_SECONDARY_FLAG = {
  printing:   'printing',
  embroidery: 'embroidery',
  ironing:    'ironing_label',
  template:   'template',
};
