package com.garment.scheduler.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.garment.scheduler.entity.CapacityConfig;
import com.garment.scheduler.entity.MainPlan;
import com.garment.scheduler.entity.Style;
import com.garment.scheduler.entity.SystemConfig;
import com.garment.scheduler.mapper.CapacityConfigMapper;
import com.garment.scheduler.mapper.MainPlanMapper;
import com.garment.scheduler.mapper.StyleMapper;
import com.garment.scheduler.mapper.SystemConfigMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ScheduleEngineService {

    private final MainPlanMapper mainPlanMapper;
    private final StyleMapper styleMapper;
    private final CapacityConfigMapper capacityConfigMapper;
    private final SystemConfigMapper systemConfigMapper;

    public ScheduleEngineService(MainPlanMapper mainPlanMapper, StyleMapper styleMapper,
                                  CapacityConfigMapper capacityConfigMapper, SystemConfigMapper systemConfigMapper) {
        this.mainPlanMapper = mainPlanMapper;
        this.styleMapper = styleMapper;
        this.capacityConfigMapper = capacityConfigMapper;
        this.systemConfigMapper = systemConfigMapper;
    }

    /**
     * 倒推计算：从交期倒推各工序的上线/下线日期
     *
     * 倒推顺序：
     * 1. 缝制下线 = 交期 - shipping_buffer_days
     * 2. 缝制上线 = 缝制下线 - ceil(计划数量 / (缝制日产能 * 流水线数)) - line_change_days
     * 3. 二次加工下线 = 缝制上线（同一天，裁片库发料 = 缝制上线）
     * 4. 二次加工上线 = 二次加工下线 - ceil(计划数量 / 二次加工日产能)
     * 5. 裁剪下线 = 二次加工上线 - picking_days
     * 6. 裁剪上线 = 裁剪下线 - ceil(计划数量 / 裁剪日产能)
     */
    public MainPlan calculate(MainPlan plan) {
        // 读取系统参数
        int shippingBufferDays = getIntConfig("shipping_buffer_days", 5);
        double pickingDays = getDoubleConfig("picking_days", 3);
        double lineChangeDays = getDoubleConfig("line_change_days", 0.5);

        // 读取产能配置
        int cuttingCapacity = getDailyCapacity("cutting", 30000);
        int sewingCapacity = getDailyCapacity("sewing", 800);  // 每条线

        // 获取款式信息（用于二次加工种类）
        Style style = styleMapper.selectById(plan.getStyleId());
        String secondaryTypes = (style != null) ? style.getSecondaryTypes() : "";

        int planQty = plan.getPlanQty() != null ? plan.getPlanQty() : 0;
        int pipelineCount = plan.getPipelineCount() != null ? plan.getPipelineCount() : 1;

        if (plan.getDueDate() == null || planQty <= 0) {
            return plan;
        }

        // 1. 缝制下线 = 交期 - 缓冲天数
        LocalDate sewingEnd = plan.getDueDate().minusDays(shippingBufferDays);

        // 2. 缝制上线 = 缝制下线 - 缝制天数 - 换线时间
        int sewingDays = (int) Math.ceil((double) planQty / (sewingCapacity * pipelineCount));
        LocalDate sewingStart = sewingEnd.minusDays(sewingDays + (int) Math.ceil(lineChangeDays));

        // 3. 二次加工下线 = 缝制上线（同一天，裁片库发料 = 缝制上线）
        LocalDate secondaryEnd = sewingStart;

        // 4. 二次加工上线 = 二次加工下线 - 二次加工天数
        // 二次加工可能有多种（印花、刺绣等），取最长的
        LocalDate secondaryStart = secondaryEnd;
        if (secondaryTypes != null && !secondaryTypes.isBlank()) {
            int maxSecondaryDays = 0;
            String[] types = secondaryTypes.split(",");
            for (String type : types) {
                String processType = mapSecondaryType(type.trim());
                int capacity = getDailyCapacity(processType, 5000);
                int days = (int) Math.ceil((double) planQty / capacity);
                maxSecondaryDays = Math.max(maxSecondaryDays, days);
            }
            secondaryStart = secondaryEnd.minusDays(maxSecondaryDays);
        }

        // 5. 裁剪下线 = 二次加工上线 - 挑片天数
        LocalDate cuttingEnd = secondaryStart.minusDays((int) Math.ceil(pickingDays));

        // 6. 裁剪上线 = 裁剪下线 - 裁剪天数
        int cuttingDays = (int) Math.ceil((double) planQty / cuttingCapacity);
        LocalDate cuttingStart = cuttingEnd.minusDays(cuttingDays);

        // 设置日期
        plan.setCuttingStart(cuttingStart);
        plan.setCuttingEnd(cuttingEnd);
        plan.setSecondaryStart(secondaryStart);
        plan.setSecondaryEnd(secondaryEnd);
        plan.setSewingRemindDate(sewingStart);  // 提醒日期 = 上线日期
        plan.setSewingStart(sewingStart);
        plan.setSewingEnd(sewingEnd);

        return plan;
    }

    /**
     * 保存并自动计算倒推
     */
    public MainPlan saveAndCalculate(MainPlan plan) {
        plan = calculate(plan);
        if (plan.getId() != null) {
            mainPlanMapper.updateById(plan);
        } else {
            mainPlanMapper.insert(plan);
        }
        return plan;
    }

    /**
     * 批量重新计算所有主计划的日期
     */
    public int recalculateAll() {
        List<MainPlan> plans = mainPlanMapper.selectList(null);
        int count = 0;
        for (MainPlan plan : plans) {
            if (plan.getDueDate() != null && plan.getPlanQty() != null && plan.getPlanQty() > 0) {
                calculate(plan);
                mainPlanMapper.updateById(plan);
                count++;
            }
        }
        return count;
    }

    private String mapSecondaryType(String type) {
        return switch (type) {
            case "印花" -> "printing";
            case "刺绣" -> "embroidery";
            case "模板" -> "template";
            case "烫标" -> "ironing";
            default -> type.toLowerCase();
        };
    }

    private int getIntConfig(String key, int defaultValue) {
        SystemConfig config = systemConfigMapper.selectById(key);
        if (config != null && config.getConfigValue() != null && !config.getConfigValue().isBlank()) {
            try {
                return Integer.parseInt(config.getConfigValue());
            } catch (NumberFormatException e) {
                return defaultValue;
            }
        }
        return defaultValue;
    }

    private double getDoubleConfig(String key, double defaultValue) {
        SystemConfig config = systemConfigMapper.selectById(key);
        if (config != null && config.getConfigValue() != null && !config.getConfigValue().isBlank()) {
            try {
                return Double.parseDouble(config.getConfigValue());
            } catch (NumberFormatException e) {
                return defaultValue;
            }
        }
        return defaultValue;
    }

    private int getDailyCapacity(String processType, int defaultValue) {
        CapacityConfig config = capacityConfigMapper.selectOne(
                new LambdaQueryWrapper<CapacityConfig>().eq(CapacityConfig::getProcessType, processType));
        return (config != null && config.getDailyCapacity() != null) ? config.getDailyCapacity() : defaultValue;
    }
}
