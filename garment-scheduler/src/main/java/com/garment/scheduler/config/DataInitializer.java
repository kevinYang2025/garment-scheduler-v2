package com.garment.scheduler.config;

import com.garment.scheduler.entity.Style;
import com.garment.scheduler.mapper.StyleMapper;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

@Component
public class DataInitializer implements CommandLineRunner {

    private final StyleMapper styleMapper;

    public DataInitializer(StyleMapper styleMapper) {
        this.styleMapper = styleMapper;
    }

    @Override
    public void run(String... args) {
        if (styleMapper.selectCount(null) > 0) {
            return;
        }

        List<Style> styles = List.of(
            build("A001", "短袖T恤", "FB-001", "T恤类", "红色", "M", 5000, "UNIQLO", LocalDate.of(2026, 7, 15), "印花"),
            build("A001", "短袖T恤", "FB-001", "T恤类", "红色", "L", 5000, "UNIQLO", LocalDate.of(2026, 7, 15), "印花"),
            build("A001", "短袖T恤", "FB-001", "T恤类", "白色", "M", 3000, "UNIQLO", LocalDate.of(2026, 7, 15), "印花"),
            build("A002", "长袖衬衫", "FB-002", "衬衫类", "蓝色", "L", 3000, "H&M", LocalDate.of(2026, 7, 20), "刺绣,模板"),
            build("A002", "长袖衬衫", "FB-002", "衬衫类", "蓝色", "XL", 2000, "H&M", LocalDate.of(2026, 7, 20), "刺绣,模板"),
            build("A003", "连帽卫衣", "FB-003", "卫衣类", "黑色", "M", 4000, "NIKE", LocalDate.of(2026, 7, 25), "印花,烫标"),
            build("A003", "连帽卫衣", "FB-003", "卫衣类", "黑色", "L", 4000, "NIKE", LocalDate.of(2026, 7, 25), "印花,烫标"),
            build("A003", "连帽卫衣", "FB-003", "卫衣类", "灰色", "M", 2000, "NIKE", LocalDate.of(2026, 7, 25), "印花,烫标"),
            build("A004", "休闲长裤", "FB-004", "裤类", "卡其", "M", 6000, "ZARA", LocalDate.of(2026, 7, 18), ""),
            build("A004", "休闲长裤", "FB-004", "裤类", "卡其", "L", 4000, "ZARA", LocalDate.of(2026, 7, 18), ""),
            build("A004", "休闲长裤", "FB-004", "裤类", "黑色", "M", 3000, "ZARA", LocalDate.of(2026, 7, 18), ""),
            build("A005", "牛仔夹克", "FB-005", "夹克类", "深蓝", "L", 2000, "LEVIS", LocalDate.of(2026, 8, 1), "刺绣"),
            build("A005", "牛仔夹克", "FB-005", "夹克类", "深蓝", "XL", 1500, "LEVIS", LocalDate.of(2026, 8, 1), "刺绣"),
            build("A006", "运动短裤", "FB-006", "裤类", "黑色", "M", 8000, "ADIDAS", LocalDate.of(2026, 7, 10), ""),
            build("A006", "运动短裤", "FB-006", "裤类", "黑色", "L", 5000, "ADIDAS", LocalDate.of(2026, 7, 10), ""),
            build("A007", "POLO衫", "FB-007", "T恤类", "白色", "M", 4000, "RALPH LAUREN", LocalDate.of(2026, 7, 30), "烫标"),
            build("A007", "POLO衫", "FB-007", "T恤类", "白色", "L", 3000, "RALPH LAUREN", LocalDate.of(2026, 7, 30), "烫标"),
            build("A007", "POLO衫", "FB-007", "T恤类", "深蓝", "M", 2000, "RALPH LAUREN", LocalDate.of(2026, 7, 30), "烫标"),
            build("A008", "工装马甲", "FB-008", "马甲类", "军绿", "L", 1500, "CARHARTT", LocalDate.of(2026, 8, 5), "模板"),
            build("A008", "工装马甲", "FB-008", "马甲类", "军绿", "XL", 1000, "CARHARTT", LocalDate.of(2026, 8, 5), "模板")
        );

        styles.forEach(styleMapper::insert);
        System.out.println("✅ 已初始化 " + styles.size() + " 条款式测试数据");
    }

    private Style build(String styleNo, String productName, String fabricCode, String category,
                        String color, String sizeSpec, int planQty, String customer,
                        LocalDate dueDate, String secondaryTypes) {
        Style s = new Style();
        s.setStyleNo(styleNo);
        s.setProductName(productName);
        s.setFabricCode(fabricCode);
        s.setCategory(category);
        s.setColor(color);
        s.setSizeSpec(sizeSpec);
        s.setPlanQty(planQty);
        s.setCustomer(customer);
        s.setDueDate(dueDate);
        s.setSecondaryTypes(secondaryTypes);
        s.setStatus("待排");
        return s;
    }
}
