package com.garment.scheduler.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.garment.scheduler.entity.*;
import com.garment.scheduler.mapper.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/warehouse")
public class WarehouseController {

    private final WarehouseInboundMapper inboundMapper;
    private final WarehouseOutboundMapper outboundMapper;
    private final WarehouseInventoryMapper inventoryMapper;

    public WarehouseController(WarehouseInboundMapper inboundMapper,
                               WarehouseOutboundMapper outboundMapper,
                               WarehouseInventoryMapper inventoryMapper) {
        this.inboundMapper = inboundMapper;
        this.outboundMapper = outboundMapper;
        this.inventoryMapper = inventoryMapper;
    }

    // —— 入库 ——
    @GetMapping("/{type}/inbound")
    public List<WarehouseInbound> listInbound(@PathVariable String type) {
        return inboundMapper.selectList(
                new LambdaQueryWrapper<WarehouseInbound>()
                        .eq(WarehouseInbound::getWarehouseType, type)
                        .orderByDesc(WarehouseInbound::getInboundDate));
    }

    @PostMapping("/{type}/inbound")
    public Map<String, Object> addInbound(@PathVariable String type, @RequestBody WarehouseInbound record) {
        record.setWarehouseType(type);
        inboundMapper.insert(record);
        updateInventory(type, record.getStyleNo(), record.getColor(), record.getSizeSpec(), record.getQty());
        return Map.of("ok", true, "id", record.getId());
    }

    // —— 出库 ——
    @GetMapping("/{type}/outbound")
    public List<WarehouseOutbound> listOutbound(@PathVariable String type) {
        return outboundMapper.selectList(
                new LambdaQueryWrapper<WarehouseOutbound>()
                        .eq(WarehouseOutbound::getWarehouseType, type)
                        .orderByDesc(WarehouseOutbound::getOutboundDate));
    }

    @PostMapping("/{type}/outbound")
    public Map<String, Object> addOutbound(@PathVariable String type, @RequestBody WarehouseOutbound record) {
        // [#20] Check inventory sufficiency before outbound
        if (record.getQty() <= 0) {
            return Map.of("ok", false, "error", "出库数量必须大于0");
        }
        WarehouseInventory inv = inventoryMapper.selectOne(
                new LambdaQueryWrapper<WarehouseInventory>()
                        .eq(WarehouseInventory::getWarehouseType, type)
                        .eq(WarehouseInventory::getStyleNo, record.getStyleNo())
                        .eq(WarehouseInventory::getColor, record.getColor() != null ? record.getColor() : "")
                        .eq(WarehouseInventory::getSizeSpec, record.getSizeSpec() != null ? record.getSizeSpec() : ""));
        if (inv == null || inv.getCurrentQty() < record.getQty()) {
            int currentQty = inv != null ? inv.getCurrentQty() : 0;
            return Map.of("ok", false, "error", "库存不足，当前库存 " + currentQty + "，出库 " + record.getQty());
        }

        record.setWarehouseType(type);
        outboundMapper.insert(record);
        updateInventory(type, record.getStyleNo(), record.getColor(), record.getSizeSpec(), -record.getQty());
        return Map.of("ok", true, "id", record.getId());
    }

    // —— 动态库存 ——
    @GetMapping("/{type}/inventory")
    public List<WarehouseInventory> listInventory(@PathVariable String type) {
        return inventoryMapper.selectList(
                new LambdaQueryWrapper<WarehouseInventory>()
                        .eq(WarehouseInventory::getWarehouseType, type));
    }

    private void updateInventory(String type, String styleNo, String color, String sizeSpec, int delta) {
        WarehouseInventory inv = inventoryMapper.selectOne(
                new LambdaQueryWrapper<WarehouseInventory>()
                        .eq(WarehouseInventory::getWarehouseType, type)
                        .eq(WarehouseInventory::getStyleNo, styleNo)
                        .eq(WarehouseInventory::getColor, color)
                        .eq(WarehouseInventory::getSizeSpec, sizeSpec));

        if (inv == null) {
            inv = new WarehouseInventory();
            inv.setWarehouseType(type);
            inv.setStyleNo(styleNo);
            inv.setColor(color);
            inv.setSizeSpec(sizeSpec);
            inv.setCurrentQty(Math.max(0, delta));
            inventoryMapper.insert(inv);
        } else {
            inv.setCurrentQty(Math.max(0, inv.getCurrentQty() + delta));
            inventoryMapper.updateById(inv);
        }
    }
}
