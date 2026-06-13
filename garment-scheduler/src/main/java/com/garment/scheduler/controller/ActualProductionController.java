package com.garment.scheduler.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.garment.scheduler.entity.ActualProduction;
import com.garment.scheduler.entity.ScheduleDaily;
import com.garment.scheduler.entity.ScheduleMaster;
import com.garment.scheduler.mapper.ActualProductionMapper;
import com.garment.scheduler.mapper.ScheduleDailyMapper;
import com.garment.scheduler.mapper.ScheduleMasterMapper;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/actual")
public class ActualProductionController {

    private final ActualProductionMapper actualMapper;
    private final ScheduleDailyMapper dailyMapper;
    private final ScheduleMasterMapper masterMapper;

    public ActualProductionController(ActualProductionMapper actualMapper,
                                       ScheduleDailyMapper dailyMapper,
                                       ScheduleMasterMapper masterMapper) {
        this.actualMapper = actualMapper;
        this.dailyMapper = dailyMapper;
        this.masterMapper = masterMapper;
    }

    @GetMapping
    public List<ActualProduction> list(@RequestParam(required = false) String scheduleType) {
        if (scheduleType != null && !scheduleType.isBlank()) {
            return actualMapper.selectList(
                    new LambdaQueryWrapper<ActualProduction>()
                            .eq(ActualProduction::getScheduleType, scheduleType)
                            .orderByDesc(ActualProduction::getProductionDate));
        }
        return actualMapper.selectList(null);
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody ActualProduction record) {
        if (record.getId() != null) {
            actualMapper.updateById(record);
        } else {
            actualMapper.insert(record);
        }

        // 自动同步到 schedule_daily 的 ACTUAL 行
        syncToDailyActual(record);

        return Map.of("ok", true, "id", record.getId());
    }

    /**
     * 同步实际生产数据到排程每日明细
     * 1. 找到对应的 schedule_master（按 scheduleType + styleId）
     * 2. 找到该日期的 ACTUAL 行，更新数量
     * 3. 重新计算该日期的 DIFF 行
     */
    private void syncToDailyActual(ActualProduction record) {
        // 1. 找到对应的 schedule_master
        List<ScheduleMaster> masters = masterMapper.selectList(
                new LambdaQueryWrapper<ScheduleMaster>()
                        .eq(ScheduleMaster::getScheduleType, record.getScheduleType())
                        .eq(ScheduleMaster::getStyleId, record.getStyleId()));

        for (ScheduleMaster master : masters) {
            // 2. 查找该日期的 ACTUAL 行
            ScheduleDaily actualDay = dailyMapper.selectOne(
                    new LambdaQueryWrapper<ScheduleDaily>()
                            .eq(ScheduleDaily::getMasterId, master.getId())
                            .eq(ScheduleDaily::getScheduleDate, record.getProductionDate())
                            .eq(ScheduleDaily::getRowType, "ACTUAL"));

            if (actualDay != null) {
                // 更新已有的 ACTUAL 行
                actualDay.setQty(record.getCompletedQty());
                dailyMapper.updateById(actualDay);
            } else {
                // 创建新的 ACTUAL 行
                actualDay = new ScheduleDaily();
                actualDay.setMasterId(master.getId());
                actualDay.setScheduleDate(record.getProductionDate());
                actualDay.setRowType("ACTUAL");
                actualDay.setQty(record.getCompletedQty());
                dailyMapper.insert(actualDay);
            }

            // 3. 更新 DIFF 行
            ScheduleDaily planDay = dailyMapper.selectOne(
                    new LambdaQueryWrapper<ScheduleDaily>()
                            .eq(ScheduleDaily::getMasterId, master.getId())
                            .eq(ScheduleDaily::getScheduleDate, record.getProductionDate())
                            .eq(ScheduleDaily::getRowType, "PLAN"));

            int planQty = (planDay != null) ? planDay.getQty() : 0;
            int diff = record.getCompletedQty() - planQty;

            ScheduleDaily diffDay = dailyMapper.selectOne(
                    new LambdaQueryWrapper<ScheduleDaily>()
                            .eq(ScheduleDaily::getMasterId, master.getId())
                            .eq(ScheduleDaily::getScheduleDate, record.getProductionDate())
                            .eq(ScheduleDaily::getRowType, "DIFF"));

            if (diffDay != null) {
                diffDay.setQty(diff);
                dailyMapper.updateById(diffDay);
            } else {
                diffDay = new ScheduleDaily();
                diffDay.setMasterId(master.getId());
                diffDay.setScheduleDate(record.getProductionDate());
                diffDay.setRowType("DIFF");
                diffDay.setQty(diff);
                dailyMapper.insert(diffDay);
            }
        }
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        actualMapper.deleteById(id);
        return Map.of("ok", true);
    }
}
