package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@TableName("actual_production")
public class ActualProduction {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String scheduleType;
    private Long styleId;
    private String styleNo;
    private String color;
    private String sizeSpec;
    private LocalDate productionDate;
    private Integer completedQty;
    private Integer defectQty;
    private String workshop;
    private String lineTeam;
    private String remark;
    private LocalDateTime recordedAt;
}
