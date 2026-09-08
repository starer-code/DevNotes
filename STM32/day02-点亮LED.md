# Day 02 - 点亮第一颗 LED

> 2026-09-08 | STM32 学习第二天

## 完成内容

- 成功点亮第一颗 LED 灯
- 代码路径:`D:\Projects\STM32Project\3-1点亮LED灯\User\main.c`

## 代码要点

```c
// PA0 配置为推挽输出
GPIO_InitStructure.GPIO_Pin = GPIO_Pin_0;
GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_PP;  // 推挽输出
GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;
GPIO_Init(GPIOA, &GPIO_InitStructure);

// 低电平点亮 LED
GPIO_ResetBits(GPIOA, GPIO_Pin_0);
```

## 关键理解

- GPIO 配置:推挽输出模式，速度 50MHz
- LED 驱动:低电平有效，`GPIO_ResetBits` 拉低点亮
- 当前状态:常亮，`while(1)` 为空

## 下一步计划

- 添加延时函数实现 LED 闪烁
- 学习定时器配置
- 尝试按键中断控制
