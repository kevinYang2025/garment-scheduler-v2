package com.garment.scheduler.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.garment.scheduler.entity.*;
import com.garment.scheduler.mapper.*;
import com.garment.scheduler.service.ScheduleEngineService;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/visual-schedule")
public class VisualScheduleController {

    private final MainPlanMapper mainPlanMapper;
    private final StyleMapper styleMapper;
    private final WorkshopMapper workshopMapper;
    private final ProductionLineMapper productionLineMapper;
    private final ScheduleMasterMapper scheduleMasterMapper;
    private final CapacityConfigMapper capacityConfigMapper;
    private final SystemConfigMapper systemConfigMapper;
    private final ScheduleEngineService engineService;

    public VisualScheduleController(MainPlanMapper mainPlanMapper, StyleMapper styleMapper,
                                     WorkshopMapper workshopMapper, ProductionLineMapper productionLineMapper,
                                     ScheduleMasterMapper scheduleMasterMapper,
                                     CapacityConfigMapper capacityConfigMapper,
                                     SystemConfigMapper systemConfigMapper,
                                     ScheduleEngineService engineService) {
        this.mainPlanMapper = mainPlanMapper;
        this.styleMapper = styleMapper;
        this.workshopMapper = workshopMapper;
        this.productionLineMapper = productionLineMapper;
        this.scheduleMasterMapper = scheduleMasterMapper;
        this.capacityConfigMapper = capacityConfigMapper;
        this.systemConfigMapper = systemConfigMapper;
        this.engineService = engineService;
    }

    @GetMapping("/gantt")
    public Map<String, Object> getGanttData() {
        List<Workshop> workshops = workshopMapper.selectList(
                new LambdaQueryWrapper<Workshop>().orderByAsc(Workshop::getSortOrder));
        List<ProductionLine> lines = productionLineMapper.selectList(
                new LambdaQueryWrapper<ProductionLine>().orderByAsc(ProductionLine::getSortOrder));
        List<MainPlan> plans = mainPlanMapper.selectList(
                new LambdaQueryWrapper<MainPlan>().eq(MainPlan::getIsScheduled, true));

        // [#19] Batch load all styles once instead of N+1
        Set<Long> styleIds = new HashSet<>();
        for (MainPlan plan : plans) {
            if (plan.getStyleId() != null) styleIds.add(plan.getStyleId());
        }
        Map<Long, Style> styleMap = new HashMap<>();
        if (!styleIds.isEmpty()) {
            styleMapper.selectBatchIds(styleIds).forEach(s -> styleMap.put(s.getId(), s));
        }

        Map<Long, List<ProductionLine>> linesByWorkshop = lines.stream()
                .collect(Collectors.groupingBy(ProductionLine::getWorkshopId));

        List<Map<String, Object>> workshopData = new ArrayList<>();
        for (Workshop workshop : workshops) {
            Map<String, Object> ws = new HashMap<>();
            ws.put("id", workshop.getId());
            ws.put("name", workshop.getName());

            List<Map<String, Object>> lineData = new ArrayList<>();
            List<ProductionLine> wsLines = linesByWorkshop.getOrDefault(workshop.getId(), List.of());
            for (ProductionLine line : wsLines) {
                Map<String, Object> ld = new HashMap<>();
                ld.put("id", line.getId());
                ld.put("name", line.getLineName());
                ld.put("status", line.getStatus());

                List<Map<String, Object>> tasks = new ArrayList<>();
                for (MainPlan plan : plans) {
                    if (workshop.getName().equals(plan.getWorkshop()) &&
                        line.getLineName().equals(plan.getLineTeam())) {
                        Style style = styleMap.get(plan.getStyleId());
                        Map<String, Object> task = new HashMap<>();
                        task.put("planId", plan.getId());
                        task.put("styleId", plan.getStyleId());
                        task.put("styleNo", plan.getStyleNo());
                        task.put("productName", plan.getProductName());
                        task.put("planQty", plan.getPlanQty());
                        task.put("sewingStart", plan.getSewingStart());
                        task.put("sewingEnd", plan.getSewingEnd());
                        task.put("color", style != null ? style.getColor() : "");
                        task.put("sizeSpec", style != null ? style.getSizeSpec() : "");
                        tasks.add(task);
                    }
                }
                ld.put("tasks", tasks);
                lineData.add(ld);
            }
            ws.put("lines", lineData);
            workshopData.add(ws);
        }

        List<MainPlan> unscheduled = mainPlanMapper.selectList(
                new LambdaQueryWrapper<MainPlan>().eq(MainPlan::getIsScheduled, false));

        // [#19] Batch load unscheduled styles too
        Set<Long> unscheduledStyleIds = new HashSet<>();
        for (MainPlan plan : unscheduled) {
            if (plan.getStyleId() != null) unscheduledStyleIds.add(plan.getStyleId());
        }
        Map<Long, Style> unscheduledStyleMap = new HashMap<>();
        if (!unscheduledStyleIds.isEmpty()) {
            styleMapper.selectBatchIds(unscheduledStyleIds).forEach(s -> unscheduledStyleMap.put(s.getId(), s));
        }

        List<Map<String, Object>> unscheduledList = new ArrayList<>();
        for (MainPlan plan : unscheduled) {
            Style style = unscheduledStyleMap.get(plan.getStyleId());
            Map<String, Object> item = new HashMap<>();
            item.put("planId", plan.getId());
            item.put("styleId", plan.getStyleId());
            item.put("styleNo", plan.getStyleNo());
            item.put("productName", plan.getProductName());
            item.put("planQty", plan.getPlanQty());
            item.put("dueDate", plan.getDueDate());
            item.put("sewingStart", plan.getSewingStart());
            item.put("sewingEnd", plan.getSewingEnd());
            item.put("color", style != null ? style.getColor() : "");
            item.put("sizeSpec", style != null ? style.getSizeSpec() : "");
            item.put("category", style != null ? style.getCategory() : "");
            unscheduledList.add(item);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("workshops", workshopData);
        result.put("unscheduled", unscheduledList);
        return result;
    }

    @PostMapping("/assign")
    public Map<String, Object> assignToLine(@RequestBody Map<String, Object> request) {
        Object planIdObj = request.get("planId");
        Object workshopObj = request.get("workshop");
        Object lineTeamObj = request.get("lineTeam");
        if (planIdObj == null || workshopObj == null || lineTeamObj == null) {
            return Map.of("ok", false, "error", "缺少必填参数");
        }
        Long planId = Long.valueOf(planIdObj.toString());
        String workshop = workshopObj.toString();
        String lineTeam = lineTeamObj.toString();

        MainPlan plan = mainPlanMapper.selectById(planId);
        if (plan == null) {
            return Map.of("ok", false, "error", "计划不存在");
        }

        List<MainPlan> existingPlans = mainPlanMapper.selectList(
                new LambdaQueryWrapper<MainPlan>()
                        .eq(MainPlan::getWorkshop, workshop)
                        .eq(MainPlan::getLineTeam, lineTeam)
                        .eq(MainPlan::getIsScheduled, true)
                        .isNotNull(MainPlan::getSewingEnd)
                        .orderByDesc(MainPlan::getSewingEnd));

        LocalDate lastEndDate = null;
        if (!existingPlans.isEmpty()) {
            lastEndDate = existingPlans.get(0).getSewingEnd();
        }

        // [#21] Read lineChangeDays from system_config
        double lineChangeDays = getDoubleConfig("line_change_days", 0.5);
        LocalDate newStart;
        if (lastEndDate != null) {
            newStart = lastEndDate.plusDays((int) Math.ceil(lineChangeDays));
        } else {
            newStart = plan.getSewingStart();
        }

        // [#22] Read sewingCapacity from capacity_config
        int sewingCapacity = getIntConfig("sewing_capacity", 800);
        int pipelineCount = plan.getPipelineCount() != null ? plan.getPipelineCount() : 1;
        int sewingDays = (int) Math.ceil((double) plan.getPlanQty() / (sewingCapacity * pipelineCount));
        LocalDate newEnd = newStart.plusDays(sewingDays);

        // 更新计划
        plan.setWorkshop(workshop);
        plan.setLineTeam(lineTeam);
        plan.setSewingStart(newStart);
        plan.setSewingEnd(newEnd);
        plan.setSewingRemindDate(newStart);
        plan.setIsScheduled(true);

        // 重新倒推其他日期
        engineService.calculate(plan);
        // 保持缝制日期不变（以拖拽后的为准）
        plan.setSewingStart(newStart);
        plan.setSewingEnd(newEnd);
        plan.setSewingRemindDate(newStart);

        mainPlanMapper.updateById(plan);

        return Map.of("ok", true, "plan", plan);
    }

    /**
     * 取消排班
     */
    @PostMapping("/unassign")
    public Map<String, Object> unassign(@RequestBody Map<String, Object> request) {
        Object planIdObj = request.get("planId");
        if (planIdObj == null) {
            return Map.of("ok", false, "error", "缺少planId参数");
        }
        Long planId = Long.valueOf(planIdObj.toString());

        MainPlan plan = mainPlanMapper.selectById(planId);
        if (plan == null) {
            return Map.of("ok", false, "error", "计划不存在");
        }

        plan.setWorkshop("");
        plan.setLineTeam("");
        plan.setIsScheduled(false);
        mainPlanMapper.updateById(plan);

        return Map.of("ok", true);
    }

    /**
     * 获取日期范围（用于甘特图横轴）
     */
    @GetMapping("/date-range")
    public Map<String, Object> getDateRange() {
        List<MainPlan> plans = mainPlanMapper.selectList(
                new LambdaQueryWrapper<MainPlan>()
                        .isNotNull(MainPlan::getSewingStart)
                        .isNotNull(MainPlan::getSewingEnd));

        if (plans.isEmpty()) {
            LocalDate today = LocalDate.now();
            return Map.of("start", today.minusDays(7), "end", today.plusDays(30));
        }

        LocalDate minDate = plans.stream()
                .map(MainPlan::getSewingStart)
                .filter(Objects::nonNull)
                .min(LocalDate::compareTo)
                .orElse(LocalDate.now().minusDays(7));

        LocalDate maxDate = plans.stream()
                .map(MainPlan::getSewingEnd)
                .filter(Objects::nonNull)
                .max(LocalDate::compareTo)
                .orElse(LocalDate.now().plusDays(30));

        return Map.of("start", minDate.minusDays(3), "end", maxDate.plusDays(7));
    }

    // [#21, #22] Config helper methods
    private double getDoubleConfig(String key, double defaultValue) {
        SystemConfig config = systemConfigMapper.selectById(key);
        if (config != null && config.getConfigValue() != null && !config.getConfigValue().isBlank()) {
            try { return Double.parseDouble(config.getConfigValue()); }
            catch (NumberFormatException e) { return defaultValue; }
        }
        return defaultValue;
    }

    private int getIntConfig(String key, int defaultValue) {
        SystemConfig config = systemConfigMapper.selectById(key);
        if (config != null && config.getConfigValue() != null && !config.getConfigValue().isBlank()) {
            try { return Integer.parseInt(config.getConfigValue()); }
            catch (NumberFormatException e) { return defaultValue; }
        }
        return defaultValue;
    }
}
