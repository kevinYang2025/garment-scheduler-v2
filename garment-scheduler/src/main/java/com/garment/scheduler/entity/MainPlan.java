package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@TableName("main_plan")
public class MainPlan {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long styleId;
    private String styleNo;
    private String productName;
    private Integer planQty;
    private LocalDate dueDate;

    private LocalDate cuttingStart;
    private LocalDate cuttingEnd;

    private LocalDate secondaryStart;
    private LocalDate secondaryEnd;

    private LocalDate sewingRemindDate;
    private LocalDate sewingStart;
    private LocalDate sewingEnd;

    private Integer pipelineCount;
    private Boolean isScheduled;
    private String workshop;
    private String lineTeam;

    private LocalDateTime createdAt;
}
