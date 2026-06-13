package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@TableName("styles")
public class Style {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String styleNo;
    private String productName;
    private String fabricCode;
    private String category;
    private String color;
    private String sizeSpec;
    private Integer planQty;
    private String customer;
    private LocalDate dueDate;
    private String secondaryTypes;
    private String status;
    private LocalDateTime createdAt;
}
