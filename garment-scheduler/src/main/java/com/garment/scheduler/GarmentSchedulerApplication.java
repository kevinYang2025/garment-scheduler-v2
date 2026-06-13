package com.garment.scheduler;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.garment.scheduler.mapper")
public class GarmentSchedulerApplication {

    public static void main(String[] args) {
        SpringApplication.run(GarmentSchedulerApplication.class, args);
    }
}
