package com.garment.scheduler.util;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Excel 导入导出工具类
 */
public class ExcelUtil {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter DATETIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * 导出数据为 Excel 字节数组
     *
     * @param data     数据列表
     * @param clazz    实体类
     * @param headers  表头映射 (字段名 -> 表头名称)
     */
    public static <T> byte[] export(List<T> data, Class<T> clazz, Map<String, String> headers) throws IOException {
        try (Workbook workbook = new XSSFWorkbook();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {

            Sheet sheet = workbook.createSheet("Sheet1");

            // 创建表头样式
            CellStyle headerStyle = workbook.createCellStyle();
            Font headerFont = workbook.createFont();
            headerFont.setBold(true);
            headerStyle.setFont(headerFont);
            headerStyle.setFillForegroundColor(IndexedColors.LIGHT_CORNFLOWER_BLUE.getIndex());
            headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);

            // 写入表头
            List<String> fieldNames = new ArrayList<>(headers.keySet());
            List<String> headerNames = new ArrayList<>(headers.values());

            Row headerRow = sheet.createRow(0);
            for (int i = 0; i < headerNames.size(); i++) {
                Cell cell = headerRow.createCell(i);
                cell.setCellValue(headerNames.get(i));
                cell.setCellStyle(headerStyle);
            }

            // 写入数据
            for (int rowIdx = 0; rowIdx < data.size(); rowIdx++) {
                Row row = sheet.createRow(rowIdx + 1);
                T item = data.get(rowIdx);

                for (int colIdx = 0; colIdx < fieldNames.size(); colIdx++) {
                    Cell cell = row.createCell(colIdx);
                    Object value = getFieldValue(item, fieldNames.get(colIdx));
                    setCellValue(cell, value);
                }
            }

            // 自动调整列宽
            for (int i = 0; i < headerNames.size(); i++) {
                sheet.autoSizeColumn(i);
            }

            workbook.write(out);
            return out.toByteArray();
        }
    }

    /**
     * 从 Excel 文件导入数据
     *
     * @param file    上传的文件
     * @param clazz   实体类
     * @param headers 表头映射 (字段名 -> 表头名称)
     */
    public static <T> List<T> importExcel(MultipartFile file, Class<T> clazz, Map<String, String> headers)
            throws IOException, ReflectiveOperationException {

        List<T> result = new ArrayList<>();
        List<String> fieldNames = new ArrayList<>(headers.keySet());
        List<String> headerNames = new ArrayList<>(headers.values());

        try (InputStream is = file.getInputStream();
             Workbook workbook = new XSSFWorkbook(is)) {

            Sheet sheet = workbook.getSheetAt(0);
            Iterator<Row> rowIterator = sheet.iterator();

            // 读取表头并建立列索引映射
            if (!rowIterator.hasNext()) {
                return result;
            }

            Row headerRow = rowIterator.next();
            Map<Integer, String> columnMapping = new HashMap<>();

            for (int i = 0; i < headerRow.getLastCellNum(); i++) {
                Cell cell = headerRow.getCell(i);
                if (cell != null) {
                    String headerValue = cell.getStringCellValue().trim();
                    // 查找对应的字段名
                    for (int j = 0; j < headerNames.size(); j++) {
                        if (headerNames.get(j).equals(headerValue)) {
                            columnMapping.put(i, fieldNames.get(j));
                            break;
                        }
                    }
                }
            }

            // 读取数据行
            while (rowIterator.hasNext()) {
                Row row = rowIterator.next();
                T obj = clazz.getDeclaredConstructor().newInstance();

                for (Map.Entry<Integer, String> entry : columnMapping.entrySet()) {
                    Cell cell = row.getCell(entry.getKey());
                    if (cell != null) {
                        Field field = clazz.getDeclaredField(entry.getValue());
                        field.setAccessible(true);
                        Object value = readCellValue(cell, field.getType());
                        field.set(obj, value);
                    }
                }

                result.add(obj);
            }
        }

        return result;
    }

    private static Object getFieldValue(Object obj, String fieldName) {
        try {
            Field field = obj.getClass().getDeclaredField(fieldName);
            field.setAccessible(true);
            return field.get(obj);
        } catch (Exception e) {
            return null;
        }
    }

    private static void setCellValue(Cell cell, Object value) {
        if (value == null) {
            cell.setCellValue("");
        } else if (value instanceof Number) {
            cell.setCellValue(((Number) value).doubleValue());
        } else if (value instanceof Boolean) {
            cell.setCellValue((Boolean) value);
        } else if (value instanceof LocalDate) {
            cell.setCellValue(((LocalDate) value).format(DATE_FMT));
        } else if (value instanceof LocalDateTime) {
            cell.setCellValue(((LocalDateTime) value).format(DATETIME_FMT));
        } else {
            cell.setCellValue(value.toString());
        }
    }

    private static Object readCellValue(Cell cell, Class<?> targetType) {
        if (cell.getCellType() == CellType.BLANK) {
            return null;
        }

        String strValue = cell.toString().trim();

        if (targetType == String.class) {
            return strValue;
        } else if (targetType == Long.class || targetType == long.class) {
            return strValue.isEmpty() ? null : Long.parseLong(strValue.split("\\.")[0]);
        } else if (targetType == Integer.class || targetType == int.class) {
            return strValue.isEmpty() ? null : Integer.parseInt(strValue.split("\\.")[0]);
        } else if (targetType == Double.class || targetType == double.class) {
            return strValue.isEmpty() ? null : Double.parseDouble(strValue);
        } else if (targetType == Boolean.class || targetType == boolean.class) {
            return "true".equalsIgnoreCase(strValue) || "1".equals(strValue);
        } else if (targetType == LocalDate.class) {
            return strValue.isEmpty() ? null : LocalDate.parse(strValue, DATE_FMT);
        } else if (targetType == LocalDateTime.class) {
            return strValue.isEmpty() ? null : LocalDateTime.parse(strValue, DATETIME_FMT);
        }

        return strValue;
    }
}
