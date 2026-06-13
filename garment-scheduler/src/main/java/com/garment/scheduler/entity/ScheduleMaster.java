package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@TableName("schedule_master")
public class ScheduleMaster {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String scheduleType;
    private Long styleId;
    private String styleNo;
    private String productName;
    private String color;
    private String sizeSpec;
    private Integer planQty;
    private LocalDate planStart;
    private LocalDate planEnd;

    private String workshop;
    private String lineTeam;

    private String secondaryType;

    private LocalDateTime createdAt;
}
