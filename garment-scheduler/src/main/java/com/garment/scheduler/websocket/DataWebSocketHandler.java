package com.garment.scheduler.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.garment.scheduler.mapper.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
public class DataWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(DataWebSocketHandler.class);
    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule());
    // [#23] Use ConcurrentHashMap for thread-safe user tracking
    private final Map<String, WebSocketSession> userSessionMap = new ConcurrentHashMap<>();

    private final StyleMapper styleMapper;
    private final WorkshopMapper workshopMapper;
    private final ProductionLineMapper productionLineMapper;
    private final MainPlanMapper mainPlanMapper;
    private final ScheduleMasterMapper scheduleMasterMapper;
    private final ScheduleDailyMapper scheduleDailyMapper;
    private final ActualProductionMapper actualProductionMapper;
    private final WarehouseInboundMapper warehouseInboundMapper;
    private final WarehouseOutboundMapper warehouseOutboundMapper;
    private final WarehouseInventoryMapper warehouseInventoryMapper;
    private final CapacityConfigMapper capacityConfigMapper;
    private final SystemConfigMapper systemConfigMapper;

    public DataWebSocketHandler(StyleMapper styleMapper, WorkshopMapper workshopMapper,
                                ProductionLineMapper productionLineMapper, MainPlanMapper mainPlanMapper,
                                ScheduleMasterMapper scheduleMasterMapper, ScheduleDailyMapper scheduleDailyMapper,
                                ActualProductionMapper actualProductionMapper,
                                WarehouseInboundMapper warehouseInboundMapper,
                                WarehouseOutboundMapper warehouseOutboundMapper,
                                WarehouseInventoryMapper warehouseInventoryMapper,
                                CapacityConfigMapper capacityConfigMapper, SystemConfigMapper systemConfigMapper) {
        this.styleMapper = styleMapper;
        this.workshopMapper = workshopMapper;
        this.productionLineMapper = productionLineMapper;
        this.mainPlanMapper = mainPlanMapper;
        this.scheduleMasterMapper = scheduleMasterMapper;
        this.scheduleDailyMapper = scheduleDailyMapper;
        this.actualProductionMapper = actualProductionMapper;
        this.warehouseInboundMapper = warehouseInboundMapper;
        this.warehouseOutboundMapper = warehouseOutboundMapper;
        this.warehouseInventoryMapper = warehouseInventoryMapper;
        this.capacityConfigMapper = capacityConfigMapper;
        this.systemConfigMapper = systemConfigMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        try {
            Map<String, Object> initData = buildFullData();
            String json = objectMapper.writeValueAsString(Map.of("type", "initData", "data", initData));
            session.sendMessage(new TextMessage(json));
        } catch (IOException e) {
            log.error("WebSocket error", e);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> msg = objectMapper.readValue(message.getPayload(), Map.class);
            String type = (String) msg.get("type");

            if ("join".equals(type)) {
                String userName = (String) msg.getOrDefault("userName", "匿名用户");
                userSessionMap.put(session.getId(), session);
                session.getAttributes().put("userName", userName);
                broadcast("userList", userSessionMap.values().stream()
                        .map(s -> s.getAttributes().get("userName"))
                        .filter(Objects::nonNull).toList());
            }
        } catch (Exception e) {
            log.error("WebSocket error", e);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
        // [#24] Clean up user on disconnect
        String sessionId = session.getId();
        userSessionMap.remove(sessionId);
        broadcast("userList", userSessionMap.values().stream()
                .map(s -> s.getAttributes().get("userName"))
                .filter(Objects::nonNull).toList());
    }

    public void broadcastSection(String section, Object data) {
        try {
            Map<String, Object> msg = Map.of("type", "sectionUpdate", "section", section, "data", data);
            String json = objectMapper.writeValueAsString(msg);
            broadcastRaw(json);
        } catch (Exception e) {
            log.error("WebSocket error", e);
        }
    }

    public void broadcast(String type, Object data) {
        try {
            Map<String, Object> msg = Map.of("type", type, "data", data);
            String json = objectMapper.writeValueAsString(msg);
            broadcastRaw(json);
        } catch (Exception e) {
            log.error("WebSocket error", e);
        }
    }

    private void broadcastRaw(String json) {
        TextMessage textMessage = new TextMessage(json);
        for (WebSocketSession session : sessions) {
            if (session.isOpen()) {
                try {
                    session.sendMessage(textMessage);
                } catch (IOException e) {
                    log.error("WebSocket error", e);
                }
            }
        }
    }

    private Map<String, Object> buildFullData() {
        Map<String, Object> data = new HashMap<>();
        data.put("styles", styleMapper.selectList(null));
        data.put("workshops", workshopMapper.selectList(null));
        data.put("productionLines", productionLineMapper.selectList(null));
        data.put("mainPlan", mainPlanMapper.selectList(null));
        data.put("capacityConfig", capacityConfigMapper.selectList(null));
        data.put("systemConfig", systemConfigMapper.selectList(null));
        return data;
    }
}
