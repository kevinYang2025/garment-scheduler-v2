package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("warehouse_inventory")
public class WarehouseInventory {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String warehouseType;
    private String styleNo;
    private String color;
    private String sizeSpec;
    private Integer currentQty;
    private LocalDateTime updatedAt;
}
