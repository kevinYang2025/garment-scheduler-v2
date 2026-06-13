package com.garment.scheduler.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.garment.scheduler.entity.ScheduleDaily;
import com.garment.scheduler.entity.ScheduleMaster;
import com.garment.scheduler.mapper.ScheduleDailyMapper;
import com.garment.scheduler.mapper.ScheduleMasterMapper;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/api/schedule")
public class ScheduleController {

    private final ScheduleMasterMapper masterMapper;
    private final ScheduleDailyMapper dailyMapper;

    public ScheduleController(ScheduleMasterMapper masterMapper, ScheduleDailyMapper dailyMapper) {
        this.masterMapper = masterMapper;
        this.dailyMapper = dailyMapper;
    }

    /** 查询某类型的所有排程主记录 */
    @GetMapping("/{scheduleType}")
    public List<ScheduleMaster> list(@PathVariable String scheduleType) {
        return masterMapper.selectList(
                new LambdaQueryWrapper<ScheduleMaster>()
                        .eq(ScheduleMaster::getScheduleType, scheduleType));
    }

    /** 获取某条主记录的每日明细（按类型+日期分组，返回前端需要的三行数据） */
    @GetMapping("/{scheduleType}/{masterId}/daily")
    public List<Map<String, Object>> daily(
            @PathVariable String scheduleType,
            @PathVariable Long masterId) {
        List<ScheduleDaily> all = dailyMapper.selectList(
                new LambdaQueryWrapper<ScheduleDaily>()
                        .eq(ScheduleDaily::getMasterId, masterId)
                        .orderByAsc(ScheduleDaily::getScheduleDate));

        // 按日期分组
        Map<LocalDate, Map<String, Integer>> grouped = new LinkedHashMap<>();
        for (ScheduleDaily d : all) {
            grouped.computeIfAbsent(d.getScheduleDate(), k -> new HashMap<>())
                    .put(d.getRowType(), d.getQty());
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<LocalDate, Map<String, Integer>> entry : grouped.entrySet()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("date", entry.getKey().toString());
            row.put("plan", entry.getValue().getOrDefault("PLAN", 0));
            row.put("actual", entry.getValue().getOrDefault("ACTUAL", 0));
            int plan = (int) row.get("plan");
            int actual = (int) row.get("actual");
            row.put("diff", actual - plan);
            result.add(row);
        }
        return result;
    }

    /** 创建排程主记录 + 自动生成每日计划行 */
    @PostMapping("/{scheduleType}")
    public Map<String, Object> create(@PathVariable String scheduleType, @RequestBody ScheduleMaster master) {
        master.setScheduleType(scheduleType);
        masterMapper.insert(master);

        // 自动生成计划行
        if (master.getPlanStart() != null && master.getPlanEnd() != null && master.getPlanQty() != null && master.getPlanQty() > 0) {
            generatePlanRows(master);
        }

        return Map.of("ok", true, "id", master.getId());
    }

    /** 重新生成计划行（按天数均分产量） */
    @PostMapping("/{scheduleType}/{masterId}/regenerate")
    public Map<String, Object> regenerate(@PathVariable String scheduleType, @PathVariable Long masterId) {
        ScheduleMaster master = masterMapper.selectById(masterId);
        if (master == null) return Map.of("ok", false, "error", "记录不存在");

        // Only delete PLAN rows, preserve ACTUAL production data
        dailyMapper.delete(new LambdaQueryWrapper<ScheduleDaily>()
                .eq(ScheduleDaily::getMasterId, masterId)
                .eq(ScheduleDaily::getRowType, "PLAN"));

        generatePlanRows(master);
        return Map.of("ok", true);
    }

    private void generatePlanRows(ScheduleMaster master) {
        LocalDate start = master.getPlanStart();
        LocalDate end = master.getPlanEnd();
        if (start == null || end == null) return;

        long days = start.until(end).getDays() + 1;
        if (days <= 0) return;

        int qty = master.getPlanQty() != null ? master.getPlanQty() : 0;
        int dailyQty = (int) Math.ceil((double) qty / days);

        List<ScheduleDaily> allRows = new ArrayList<>();
        int accumulated = 0;

        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            int planForDay = Math.min(dailyQty, qty - accumulated);
            accumulated += planForDay;

            ScheduleDaily plan = new ScheduleDaily();
            plan.setMasterId(master.getId());
            plan.setScheduleDate(d);
            plan.setRowType("PLAN");
            plan.setQty(planForDay);
            allRows.add(plan);

            // [#4] Changed DIFF→ACTUAL: create ACTUAL row (initial qty=0)
            ScheduleDaily actual = new ScheduleDaily();
            actual.setMasterId(master.getId());
            actual.setScheduleDate(d);
            actual.setRowType("ACTUAL");
            actual.setQty(0);
            allRows.add(actual);
        }

        // [#26] Batch insert instead of individual inserts
        for (ScheduleDaily row : allRows) {
            dailyMapper.insert(row);
        }
    }

    /** 删除排程 */
    @DeleteMapping("/{scheduleType}/{id}")
    public Map<String, Object> delete(@PathVariable String scheduleType, @PathVariable Long id) {
        dailyMapper.delete(new LambdaQueryWrapper<ScheduleDaily>().eq(ScheduleDaily::getMasterId, id));
        masterMapper.deleteById(id);
        return Map.of("ok", true);
    }
}
