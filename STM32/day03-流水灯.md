# Day 03 - 流水灯

> 2026-09-08 | STM32 学习第三天

## 完成内容

- 实现 PA0-PA7 八个 LED 流水灯效果
- 代码路径:`D:\Projects\STM32Project\3-2流水灯\User\main.c`

## 代码要点

```c
// 配置 GPIOA 所有引脚为推挽输出
GPIO_InitStructure.GPIO_Pin = GPIO_Pin_All;  // 一次性配置所有引脚
GPIO_Init(GPIOA, &GPIO_InitStructure);

// 流水灯核心：GPIO_Write 一次写入 16 位数据
while(1)
{
    GPIO_Write(GPIOA, ~0x0001);  // 0x0001取反=0xFFFE，PA0低电平点亮
    Delay_ms(300);
    GPIO_Write(GPIOA, ~0x0002);  // PA1点亮
    Delay_ms(300);
    GPIO_Write(GPIOA, ~0x0004);  // PA2点亮
    // ... 依次类推到 PA7
}
```

## 关键理解

### GPIO 操作函数对比

| 函数 | 作用 | 使用场景 |
|---|---|---|
| `GPIO_ResetBits` | 单引脚拉低 | 单个LED控制 |
| `GPIO_SetBits` | 单引脚拉高 | 单个LED控制 |
| `GPIO_WriteBit` | 按位设置 | 单引脚精确控制 |
| `GPIO_Write` | 16位整体写入 | 多引脚同时控制 |

### 位操作技巧

- `~0x0001` = `0xFFFE` → PA0 低电平(点亮)，其余高电平(熄灭)
- `~0x0002` = `0xFFFD` → PA1 低电平(点亮)
- 位左移：`0x0001 << n` 可以简化代码

## 优化思路

当前代码是8行重复，可以用循环+移位简化：

```c
uint16_t led = 0x0001;
while(1)
{
    GPIO_Write(GPIOA, ~led);
    Delay_ms(300);
    led <<= 1;
    if(led > 0x0080) led = 0x0001;  // 从PA7回到PA0
}
```
