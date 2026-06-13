package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDate;

@Data
@TableName("schedule_daily")
public class ScheduleDaily {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long masterId;
    private LocalDate scheduleDate;
    private String rowType;
    private Integer qty;
}
