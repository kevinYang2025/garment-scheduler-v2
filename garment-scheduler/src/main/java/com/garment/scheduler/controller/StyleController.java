package com.garment.scheduler.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.garment.scheduler.entity.Style;
import com.garment.scheduler.mapper.StyleMapper;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/styles")
public class StyleController {

    private final StyleMapper styleMapper;

    public StyleController(StyleMapper styleMapper) {
        this.styleMapper = styleMapper;
    }

    @GetMapping
    public List<Style> list(@RequestParam(required = false) String keyword) {
        if (keyword != null && !keyword.isBlank()) {
            LambdaQueryWrapper<Style> wrapper = new LambdaQueryWrapper<>();
            wrapper.like(Style::getStyleNo, keyword)
                    .or().like(Style::getProductName, keyword)
                    .or().like(Style::getCustomer, keyword)
                    .or().like(Style::getColor, keyword);
            return styleMapper.selectList(wrapper);
        }
        return styleMapper.selectList(null);
    }

    @GetMapping("/{id}")
    public Style get(@PathVariable Long id) {
        return styleMapper.selectById(id);
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody Style style) {
        // [#27] Input validation
        if (style.getStyleNo() == null || style.getStyleNo().isBlank()) {
            return Map.of("ok", false, "error", "款号不能为空");
        }
        if (style.getColor() == null || style.getColor().isBlank()) {
            return Map.of("ok", false, "error", "颜色不能为空");
        }
        if (style.getSizeSpec() == null || style.getSizeSpec().isBlank()) {
            return Map.of("ok", false, "error", "尺码不能为空");
        }
        if (style.getPlanQty() != null && style.getPlanQty() < 0) {
            return Map.of("ok", false, "error", "计划数量不能为负");
        }

        if (style.getId() != null) {
            styleMapper.updateById(style);
        } else {
            styleMapper.insert(style);
        }
        return Map.of("ok", true, "id", style.getId());
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        // [#15] Check existence before delete
        Style existing = styleMapper.selectById(id);
        if (existing == null) {
            return Map.of("ok", false, "error", "款式不存在");
        }
        styleMapper.deleteById(id);
        return Map.of("ok", true);
    }
}
