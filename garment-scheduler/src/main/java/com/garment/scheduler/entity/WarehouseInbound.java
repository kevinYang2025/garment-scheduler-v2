package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@TableName("warehouse_inbound")
public class WarehouseInbound {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String warehouseType;
    private String refType;
    private Long refId;
    private String styleNo;
    private String color;
    private String sizeSpec;
    private Integer qty;
    private LocalDate inboundDate;
    private String operator;
    private LocalDateTime createdAt;
}
