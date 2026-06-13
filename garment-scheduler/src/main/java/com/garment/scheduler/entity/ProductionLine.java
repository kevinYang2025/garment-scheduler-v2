package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("production_lines")
public class ProductionLine {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long workshopId;
    private String lineName;
    private String status;
    private Integer sortOrder;
}
