package com.garment.scheduler.controller;

import com.garment.scheduler.entity.ProductionLine;
import com.garment.scheduler.entity.Workshop;
import com.garment.scheduler.mapper.ProductionLineMapper;
import com.garment.scheduler.mapper.WorkshopMapper;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/workshops")
public class WorkshopController {

    private final WorkshopMapper workshopMapper;
    private final ProductionLineMapper productionLineMapper;

    public WorkshopController(WorkshopMapper workshopMapper, ProductionLineMapper productionLineMapper) {
        this.workshopMapper = workshopMapper;
        this.productionLineMapper = productionLineMapper;
    }

    @GetMapping
    public List<Workshop> list() {
        return workshopMapper.selectList(null);
    }

    @GetMapping("/{id}/lines")
    public List<ProductionLine> lines(@PathVariable Long id) {
        return productionLineMapper.selectList(
                new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<ProductionLine>()
                        .eq(ProductionLine::getWorkshopId, id)
                        .orderByAsc(ProductionLine::getSortOrder));
    }

    @GetMapping("/lines")
    public List<ProductionLine> allLines() {
        return productionLineMapper.selectList(null);
    }

    @PutMapping("/lines/{id}")
    public java.util.Map<String, Object> updateLine(@PathVariable Long id, @RequestBody ProductionLine line) {
        line.setId(id);
        productionLineMapper.updateById(line);
        return java.util.Map.of("ok", true);
    }
}
