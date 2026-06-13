package com.garment.scheduler.controller;

import com.garment.scheduler.entity.MainPlan;
import com.garment.scheduler.mapper.MainPlanMapper;
import com.garment.scheduler.service.ScheduleEngineService;
import com.garment.scheduler.util.ExcelUtil;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/main-plan")
public class MainPlanController {

    private final MainPlanMapper mainPlanMapper;
    private final ScheduleEngineService engineService;

    public MainPlanController(MainPlanMapper mainPlanMapper, ScheduleEngineService engineService) {
        this.mainPlanMapper = mainPlanMapper;
        this.engineService = engineService;
    }

    @GetMapping
    public List<MainPlan> list() {
        return mainPlanMapper.selectList(null);
    }

    @GetMapping("/{id}")
    public MainPlan get(@PathVariable Long id) {
        return mainPlanMapper.selectById(id);
    }

    /**
     * 保存主计划并自动计算倒推日期
     */
    @PostMapping
    public Map<String, Object> save(@RequestBody MainPlan plan) {
        plan = engineService.saveAndCalculate(plan);
        return Map.of("ok", true, "id", plan.getId(), "plan", plan);
    }

    /**
     * 仅重新计算（不保存新记录，只更新日期）
     */
    @PostMapping("/{id}/recalculate")
    public Map<String, Object> recalculate(@PathVariable Long id) {
        MainPlan plan = mainPlanMapper.selectById(id);
        if (plan == null) {
            return Map.of("ok", false, "error", "记录不存在");
        }
        plan = engineService.saveAndCalculate(plan);
        return Map.of("ok", true, "plan", plan);
    }

    /**
     * 批量重新计算所有主计划
     */
    @PostMapping("/recalculate-all")
    public Map<String, Object> recalculateAll() {
        int count = engineService.recalculateAll();
        return Map.of("ok", true, "count", count);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        mainPlanMapper.deleteById(id);
        return Map.of("ok", true);
    }

    /**
     * 导出主计划为 Excel
     */
    @GetMapping("/export")
    public ResponseEntity<byte[]> exportExcel() throws IOException {
        List<MainPlan> data = mainPlanMapper.selectList(null);

        // 定义表头映射 (字段名 -> 中文表头)
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("id", "ID");
        headers.put("styleNo", "款号");
        headers.put("productName", "产品名称");
        headers.put("planQty", "计划数量");
        headers.put("dueDate", "交货日期");
        headers.put("cuttingStart", "裁剪开始");
        headers.put("cuttingEnd", "裁剪结束");
        headers.put("secondaryStart", "二次加工开始");
        headers.put("secondaryEnd", "二次加工结束");
        headers.put("sewingRemindDate", "缝制提醒日");
        headers.put("sewingStart", "缝制开始");
        headers.put("sewingEnd", "缝制结束");
        headers.put("pipelineCount", "流水线数");
        headers.put("isScheduled", "已排程");
        headers.put("workshop", "车间");
        headers.put("lineTeam", "班组");
        headers.put("createdAt", "创建时间");

        byte[] excelBytes = ExcelUtil.export(data, MainPlan.class, headers);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=main_plan.xlsx")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(excelBytes);
    }

    /**
     * 从 Excel 导入主计划
     */
    @PostMapping("/import")
    public Map<String, Object> importExcel(@RequestParam("file") MultipartFile file) {
        try {
            // 定义表头映射
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("styleNo", "款号");
            headers.put("productName", "产品名称");
            headers.put("planQty", "计划数量");
            headers.put("dueDate", "交货日期");
            headers.put("cuttingStart", "裁剪开始");
            headers.put("cuttingEnd", "裁剪结束");
            headers.put("secondaryStart", "二次加工开始");
            headers.put("secondaryEnd", "二次加工结束");
            headers.put("sewingRemindDate", "缝制提醒日");
            headers.put("sewingStart", "缝制开始");
            headers.put("sewingEnd", "缝制结束");
            headers.put("pipelineCount", "流水线数");
            headers.put("isScheduled", "已排程");
            headers.put("workshop", "车间");
            headers.put("lineTeam", "班组");

            List<MainPlan> plans = ExcelUtil.importExcel(file, MainPlan.class, headers);

            // 保存导入的数据
            int imported = 0;
            for (MainPlan plan : plans) {
                engineService.saveAndCalculate(plan);
                imported++;
            }

            return Map.of("ok", true, "imported", imported);
        } catch (Exception e) {
            return Map.of("ok", false, "error", "导入失败: " + e.getMessage());
        }
    }
}
