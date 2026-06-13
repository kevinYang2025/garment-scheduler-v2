-- ============================================================
-- 制衣工厂生产计划排程系统 V2 — 数据库 Schema
-- ============================================================

-- 1. 款式主数据（需求1、2）
CREATE TABLE IF NOT EXISTS styles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    style_no VARCHAR(100) NOT NULL,
    product_name VARCHAR(200) DEFAULT '',
    fabric_code VARCHAR(100) DEFAULT '',
    category VARCHAR(50) DEFAULT '',
    color VARCHAR(50) DEFAULT '',
    size_spec VARCHAR(50) DEFAULT '',
    plan_qty INTEGER DEFAULT 0,
    customer VARCHAR(100) DEFAULT '',
    due_date DATE NULL,
    secondary_types VARCHAR(200) DEFAULT '',
    status VARCHAR(20) DEFAULT '待排',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_style_color_size UNIQUE (style_no, color, size_spec)
);

-- 2. 车间
CREATE TABLE IF NOT EXISTS workshops (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- 3. 产线
CREATE TABLE IF NOT EXISTS production_lines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    workshop_id BIGINT NOT NULL,
    line_name VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT '空闲',
    sort_order INTEGER DEFAULT 0
);

-- 4. 主计划（需求3、4、5）
CREATE TABLE IF NOT EXISTS main_plan (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    style_id BIGINT NOT NULL,
    style_no VARCHAR(100) DEFAULT '',
    product_name VARCHAR(200) DEFAULT '',
    plan_qty INTEGER DEFAULT 0,
    due_date DATE NULL,

    cutting_start DATE NULL,
    cutting_end DATE NULL,

    secondary_start DATE NULL,
    secondary_end DATE NULL,

    sewing_remind_date DATE NULL,
    sewing_start DATE NULL,
    sewing_end DATE NULL,

    pipeline_count INTEGER DEFAULT 1,
    is_scheduled BOOLEAN DEFAULT FALSE,
    workshop VARCHAR(50) DEFAULT '',
    line_team VARCHAR(100) DEFAULT '',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. 排程主记录 — 统一模型（需求9、14、15、16）
CREATE TABLE IF NOT EXISTS schedule_master (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    schedule_type VARCHAR(20) NOT NULL,
    style_id BIGINT NOT NULL,
    style_no VARCHAR(100) DEFAULT '',
    product_name VARCHAR(200) DEFAULT '',
    color VARCHAR(50) DEFAULT '',
    size_spec VARCHAR(50) DEFAULT '',
    plan_qty INTEGER DEFAULT 0,
    plan_start DATE NULL,
    plan_end DATE NULL,

    workshop VARCHAR(50) DEFAULT '',
    line_team VARCHAR(100) DEFAULT '',

    secondary_type VARCHAR(20) DEFAULT '',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. 排程每日明细 — 三行模型（需求9、10、12）
CREATE TABLE IF NOT EXISTS schedule_daily (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    master_id BIGINT NOT NULL,
    schedule_date DATE NOT NULL,
    row_type VARCHAR(10) NOT NULL,
    qty INTEGER DEFAULT 0,
    UNIQUE (master_id, schedule_date, row_type)
);

-- 7. 实际生产数据录入（需求11）
CREATE TABLE IF NOT EXISTS actual_production (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    schedule_type VARCHAR(20) DEFAULT '',
    style_id BIGINT NOT NULL,
    style_no VARCHAR(100) DEFAULT '',
    color VARCHAR(50) DEFAULT '',
    size_spec VARCHAR(50) DEFAULT '',
    production_date DATE NOT NULL,
    completed_qty INTEGER DEFAULT 0,
    defect_qty INTEGER DEFAULT 0,
    workshop VARCHAR(50) DEFAULT '',
    line_team VARCHAR(100) DEFAULT '',
    remark VARCHAR(500) DEFAULT '',
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. 仓库入库
CREATE TABLE IF NOT EXISTS warehouse_inbound (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    warehouse_type VARCHAR(30) NOT NULL,
    ref_type VARCHAR(30) DEFAULT '',
    ref_id BIGINT NULL,
    style_no VARCHAR(100) DEFAULT '',
    color VARCHAR(50) DEFAULT '',
    size_spec VARCHAR(50) DEFAULT '',
    qty INTEGER DEFAULT 0,
    inbound_date DATE NULL,
    operator VARCHAR(50) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. 仓库出库
CREATE TABLE IF NOT EXISTS warehouse_outbound (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    warehouse_type VARCHAR(30) NOT NULL,
    ref_type VARCHAR(30) DEFAULT '',
    ref_id BIGINT NULL,
    style_no VARCHAR(100) DEFAULT '',
    color VARCHAR(50) DEFAULT '',
    size_spec VARCHAR(50) DEFAULT '',
    qty INTEGER DEFAULT 0,
    outbound_date DATE NULL,
    operator VARCHAR(50) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. 仓库动态库存
CREATE TABLE IF NOT EXISTS warehouse_inventory (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    warehouse_type VARCHAR(30) NOT NULL,
    style_no VARCHAR(100) DEFAULT '',
    color VARCHAR(50) DEFAULT '',
    size_spec VARCHAR(50) DEFAULT '',
    current_qty INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (warehouse_type, style_no, color, size_spec)
);

-- 11. 产能配置（需求5中的数字可修改）
CREATE TABLE IF NOT EXISTS capacity_config (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    process_type VARCHAR(50) NOT NULL,
    daily_capacity INTEGER DEFAULT 1000,
    unit VARCHAR(20) DEFAULT '件',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_process_type UNIQUE (process_type)
);

-- 12. 全局系统参数
CREATE TABLE IF NOT EXISTS system_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value VARCHAR(200) DEFAULT '',
    description VARCHAR(500) DEFAULT ''
);

-- 13. 公式（保留）
CREATE TABLE IF NOT EXISTS formulas (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) DEFAULT '',
    data_source VARCHAR(100) DEFAULT '',
    target_field VARCHAR(100) DEFAULT '',
    expression CLOB DEFAULT ''
);

-- 14. 系统设置（保留兼容）
CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value CLOB DEFAULT ''
);

-- ============================================================
-- 初始数据
-- ============================================================

-- 默认产能配置
INSERT INTO capacity_config (process_type, daily_capacity, unit) VALUES
    ('cutting', 30000, '件'),
    ('printing', 10000, '片'),
    ('embroidery', 5000, '件'),
    ('template', 3000, '件'),
    ('ironing', 3000, '片'),
    ('sewing', 800, '件/线');

-- 默认系统参数
INSERT INTO system_config (config_key, config_value, description) VALUES
    ('shipping_buffer_days', '5', '出货前缓冲天数，缝制下线到出货的预留时间'),
    ('picking_days', '3', '挑片天数，裁剪完成到二次加工上线之间的时间'),
    ('line_change_days', '0.5', '换线时间（天），0.5=半天'),
    ('cutting_daily_capacity', '30000', '裁剪日产能（件/天）');

-- 车间（5个）
INSERT INTO workshops (id, name, sort_order) VALUES
    (1, '一车间', 1),
    (2, '二车间', 2),
    (3, '三车间', 3),
    (4, '四车间', 4),
    (5, '五车间', 5);

-- 产线（50条，按车间分配）
INSERT INTO production_lines (id, workshop_id, line_name, sort_order) VALUES
    (1,  1, '1班', 1), (2, 1, '2班', 2), (3, 1, '3班', 3),
    (4,  1, '4班', 4), (5, 1, '5班', 5), (6, 1, '6班', 6),
    (7,  1, '7班', 7), (8, 1, '8班', 8), (9, 1, '9班', 9),
    (10, 1, '10班', 10),
    (11, 2, '11班', 1), (12, 2, '12班', 2), (13, 2, '13班', 3),
    (14, 2, '14班', 4), (15, 2, '15班', 5), (16, 2, '16班', 6),
    (17, 2, '17班', 7), (18, 2, '18班', 8), (19, 2, '19班', 9),
    (20, 2, '20班', 10), (21, 2, '2-2班', 11),
    (22, 3, '21班', 1), (23, 3, '22班', 2), (24, 3, '23班', 3),
    (25, 3, '24班', 4), (26, 3, '25班', 5), (27, 3, '26班', 6),
    (28, 3, '27班', 7), (29, 3, '28班', 8), (30, 3, '29班', 9),
    (31, 4, '31班', 1), (32, 4, '32班', 2),
    (33, 4, '35班', 3), (34, 4, '36班', 4), (35, 4, '37班', 5),
    (36, 4, '38班', 6), (37, 4, '39班', 7), (38, 4, '40班', 8),
    (39, 4, '41班', 9), (40, 4, '42班', 10),
    (41, 5, '43班', 1), (42, 5, '44班', 2), (43, 5, '45班', 3),
    (44, 5, '46班', 4), (45, 5, '47班', 5), (46, 5, '48班', 6),
    (47, 5, '49班', 7), (48, 5, '50班', 8),
    (49, 5, '53班', 9), (50, 5, '54班', 10);
