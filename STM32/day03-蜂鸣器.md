# Day 03 - 蜂鸣器控制

> 2026-09-08 | STM32 学习第三天

## 完成内容

- 实现蜂鸣器间歇鸣叫
- 代码路径:`D:\Projects\STM32Project\3-3蜂鸣器\User\main.c`

## 代码要点

```c
// 配置 PA9 为推挽输出
GPIO_InitStructure.GPIO_Pin = GPIO_Pin_9;
GPIO_Init(GPIOA, &GPIO_InitStructure);

// 蜂鸣器控制：低电平响，高电平停
while(1)
{
    GPIO_ResetBits(GPIOA, GPIO_Pin_9);  // PA9拉低→蜂鸣器响
    Delay_ms(300);
    GPIO_SetBits(GPIOA, GPIO_Pin_9);    // PA9拉高→蜂鸣器停
    Delay_ms(300);
}
```

## 关键理解

- 蜂鸣器是**低电平触发**：`ResetBits` 响，`SetBits` 停
- 与 LED 控制逻辑一致：低电平有效
- 频率决定音调：`Delay_ms` 越短，声音越尖锐

## 扩展：音调控制

```c
// 不同频率对应不同音调
// Do: Delay_ms(956)  Re: Delay_ms(852)  Mi: Delay_ms(758)
// Fa: Delay_ms(716)  Sol: Delay_ms(638) La: Delay_ms(568)

// 简单旋律示例
int melody[] = {956, 852, 758, 716, 638, 568, 506, 478};
for(int i = 0; i < 8; i++)
{
    for(int j = 0; j < 50; j++)  // 每个音持续一段时间
    {
        GPIO_ResetBits(GPIOA, GPIO_Pin_9);
        Delay_us(melody[i]);
        GPIO_SetBits(GPIOA, GPIO_Pin_9);
        Delay_us(melody[i]);
    }
}
```
