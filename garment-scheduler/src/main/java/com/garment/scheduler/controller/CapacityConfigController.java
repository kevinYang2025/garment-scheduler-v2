package com.garment.scheduler.controller;

import com.garment.scheduler.entity.CapacityConfig;
import com.garment.scheduler.entity.SystemConfig;
import com.garment.scheduler.mapper.CapacityConfigMapper;
import com.garment.scheduler.mapper.SystemConfigMapper;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/config")
public class CapacityConfigController {

    private final CapacityConfigMapper capacityMapper;
    private final SystemConfigMapper systemConfigMapper;

    public CapacityConfigController(CapacityConfigMapper capacityMapper, SystemConfigMapper systemConfigMapper) {
        this.capacityMapper = capacityMapper;
        this.systemConfigMapper = systemConfigMapper;
    }

    @GetMapping("/capacity")
    public List<CapacityConfig> listCapacity() {
        return capacityMapper.selectList(null);
    }

    @PutMapping("/capacity/{id}")
    public Map<String, Object> updateCapacity(@PathVariable Long id, @RequestBody CapacityConfig config) {
        config.setId(id);
        capacityMapper.updateById(config);
        return Map.of("ok", true);
    }

    @GetMapping("/system")
    public List<SystemConfig> listSystem() {
        return systemConfigMapper.selectList(null);
    }

    @PutMapping("/system/{key}")
    public Map<String, Object> updateSystem(@PathVariable String key, @RequestBody Map<String, String> body) {
        SystemConfig config = systemConfigMapper.selectById(key);
        if (config != null) {
            config.setConfigValue(body.get("configValue"));
            systemConfigMapper.updateById(config);
        }
        return Map.of("ok", true);
    }
}
