package com.garment.scheduler.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("formulas")
public class Formula {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private String name;
    private String dataSource;
    private String targetField;
    private String expression;
}
