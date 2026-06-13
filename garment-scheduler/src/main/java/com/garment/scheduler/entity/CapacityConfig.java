package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("capacity_config")
public class CapacityConfig {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String processType;
    private Integer dailyCapacity;
    private String unit;
    private LocalDateTime updatedAt;
}
