# 03 - 流程控制: if, for, switch

> Go 的流程控制关键字精简而强大——没有 `while`、没有 `do`、`switch` 默认不穿透

---

## 一、C++ 对照速查表

| 概念 | C++ | Go | 关键区别 |
|------|-----|-----|----------|
| 条件判断 | `if (cond) {}` | `if cond {}` | Go 不需要括号 |
| 初始化语句 | `if (int x = f(); x > 0)` (C++17) | `if x := f(); x > 0` | 语法几乎等价 |
| 基本循环 | `for (init; cond; post) {}` | `for init; cond; post {}` | Go 统一用 `for` |
| while 循环 | `while (cond) {}` | `for cond {}` | Go 无 `while` 关键字 |
| do-while | `do {} while (cond);` | `for { ...; if !cond { break } }` | Go 无 `do-while` |
| 无限循环 | `for (;;) {}` | `for {}` | Go 写法更简洁 |
| 范围遍历 | `for (auto& x : vec) {}` | `for i, v := range slice {}` | `range` 可解构 key/value |
| switch 穿透 | 默认穿透（需 `break`） | 默认不穿透（需 `fallthrough`） | **完全相反** |
| switch 无条件 | `switch { case ...: }` | `switch { case ...: }` | 两者相同 |
| 类型判断 | `dynamic_cast`/`typeid` | `switch v := x.(type)` | Go 的 type switch 更优雅 |
| 延迟执行 | RAII / 析构函数 | `defer` | `defer` 是函数级，非作用域级 |
| goto | `goto label;` | `goto label;` | 两者几乎相同 |
| 标号跳转 | `break label`（跳出循环） | `break label`（跳出标签所在的 for） | Go 标签只对 `for` 有效 |

---

## 二、if 语句

### 2.1 基本用法——不需要括号

```go
// Go: 条件表达式不需要括号
if x > 0 {
    fmt.Println("正数")
} else if x == 0 {
    fmt.Println("零")
} else {
    fmt.Println("负数")
}
```

> C++ 对照：`if (x > 0) { ... }` — Go 省略了括号，且 `{` 不能另起一行（编译器自动插入分号机制）。

### 2.2 if 带初始化语句

Go 的 `if` 可以包含一个简短语句（`:=` 声明），变量作用域仅限于 `if-else` 块内。

```go
// 常见模式：if + 赋值 + 判断
if err := doSomething(); err != nil {
    // err 在这里有效
    fmt.Println("出错:", err)
    return err
}
// 这里 err 不可见（已超出作用域）

// C++17 等价写法：
// if (auto err = doSomething(); err != nil) { ... }
```

### 2.3 多重 if 初始化

```go
if x := compute(); x > 0 {
    fmt.Println(x)
} else if y := compute(); y > 0 {
    // y 是这个分支独有的
    fmt.Println(y)
}
// x 和 y 在这里都不可见
```

> **注意**：每个 `else if` 的初始化语句中声明的变量，作用域仅属于该分支。

---

## 三、for 循环

Go 只有 `for` 一个循环关键字，但它能表达 C++ 中 `for`、`while`、`do-while` 的所有场景。

### 3.1 经典三段式

```go
// 与 C++ 几乎相同，只是没有括号
for i := 0; i < 10; i++ {
    fmt.Println(i)
}

// 无限循环（C++: for (;;)）
for {
    // ...
    break // 跳出
}
```

### 3.2 while 等价写法

```go
// C++: while (n > 0) { ... }
for n > 0 {
    n /= 2
}

// C++: do { ... } while (cond);
for {
    doSomething()
    if !cond {
        break
    }
}
```

### 3.3 for range —— 遍历利器

`range` 可遍历数组、切片、map、字符串、通道。

```go
// 遍历切片 —— 类似 C++ 的 range-based for
nums := []int{10, 20, 30}

for i, v := range nums {
    fmt.Printf("索引=%d, 值=%d\n", i, v)
}

// 只需要索引
for i := range nums {
    fmt.Println(i)
}

// 只需要值（C++: for (auto v : nums)）
for _, v := range nums {
    fmt.Println(v)
}

// 遍历 map
m := map[string]int{"a": 1, "b": 2}
for k, v := range m {
    fmt.Printf("%s => %d\n", k, v)
}

// 遍历字符串（按 rune，不是 byte）
for i, ch := range "Hello, 世界" {
    fmt.Printf("字节位置=%d, 字符=%c\n", i, ch)
}
```

> **注意**：`range` 返回的是值的**副本**。要修改切片元素，必须通过索引：
> ```go
> for i := range nums {
>     nums[i] *= 2 // 通过索引修改原切片
> }
> ```

### 3.4 无限循环

```go
// 常见于服务器、事件循环
for {
    select {
    case msg := <-ch:
        process(msg)
    }
}
```

### 3.5 break/continue 带标签

Go 的 `break` 和 `continue` 可以配合**标签**作用于外层 `for` 循环（这是与 C++ 不同的点）。

```go
// 标签只能标记 for 循环
Outer:
    for i := 0; i < 5; i++ {
        for j := 0; j < 5; j++ {
            if i+j > 4 {
                break Outer // 跳出外层循环
            }
            fmt.Println(i, j)
        }
    }

// continue 也可以带标签
Loop:
    for i := 0; i < 10; i++ {
        if i%3 == 0 {
            continue Loop // 跳过本次外层循环迭代
        }
        fmt.Println(i) // 输出: 1, 2, 4, 5, 7, 8
    }
```

> **对比 C++**：C++ 的标签通常配合 `goto` 使用，Go 的标签主要服务于 `break/continue`，`goto` 使用场景极少。

---

## 四、switch 语句

Go 的 `switch` 比 C++ 的更灵活，默认行为也完全相反。

### 4.1 基本用法——默认不穿透

```go
// Go: switch 默认不穿透，不需要 break
switch day {
case "Mon", "Tue", "Wed", "Thu", "Fri":
    fmt.Println("工作日")
case "Sat", "Sun":
    fmt.Println("周末")
default:
    fmt.Println("未知")
}
```

> **关键差异**：C++ 的 `switch` 每个 `case` 默认穿透（fall through），需要显式 `break`；Go 正好相反，**默认不穿透**。

### 4.2 显式 fallthrough

```go
switch n := 1; {
case n == 1:
    fmt.Println("one")
    fallthrough // 穿透到下一个 case，**无条件执行**
case n == 2:
    fmt.Println("two") // 即使 n != 2 也会执行（fallthrough 无条件）
case n == 3:
    fmt.Println("three")
}
```

> **注意**：Go 的 `fallthrough` 是无条件的——它不会检查下一个 `case` 的条件，直接执行下一个 `case` 的代码体。这与 C++ 的穿透行为不同。

### 4.3 switch 无条件（等价 if-else 链）

当 `switch` 没有表达式时，每个 `case` 都是一个独立的布尔表达式，适合替代冗长的 `if-else if` 链。

```go
switch {
case score >= 90:
    fmt.Println("优秀")
case score >= 80:
    fmt.Println("良好")
case score >= 60:
    fmt.Println("及格")
default:
    fmt.Println("不及格")
}
```

### 4.4 Type Switch —— 类型断言的利器

```go
// 接口类型判断（C++ 中没有直接对应，最接近 dynamic_cast）
var i interface{} = "hello"

switch v := i.(type) {
case int:
    fmt.Printf("整数: %d\n", v)
case string:
    fmt.Printf("字符串: %s\n", v) // v 被推断为 string 类型
case bool:
    fmt.Printf("布尔: %v\n", v)
default:
    fmt.Printf("未知类型: %T\n", v)
}
```

> `i.(type)` 只能在 `switch` 中使用。变量 `v` 在每个 `case` 分支中自动被推断为对应类型，无需手动类型断言。

---

## 五、goto、break、continue

### 5.1 goto（极少使用）

```go
// goto 在 Go 中很少使用，但语法上存在
func findInMatrix(matrix [][]int, target int) (int, int) {
    for i := range matrix {
        for j, v := range matrix[i] {
            if v == target {
                goto found // 直接跳转
            }
        }
    }
    return -1, -1

found:
    // 找到目标后的处理逻辑
    return i, j // 注意：goto 跳转后仍可使用作用域内的变量
}
```

> **Go 的惯例**：能用 `return`、`break`、`continue` 解决的，就不要用 `goto`。官方编译器会警告不必要的 `goto`。

### 5.2 break —— 跳出循环或 switch

```go
// break 在 switch 中不需要标签，默认只跳出当前 switch
switch x {
case 1:
    fmt.Println("one")
    // break 可省略，但有时显式写出增加可读性
}

// break 跳出指定标签的 for 循环（见 3.5 节）
```

### 5.3 continue —— 跳过当前迭代

```go
// 跳过偶数
for i := 0; i < 10; i++ {
    if i%2 == 0 {
        continue
    }
    fmt.Println(i) // 只输出奇数: 1, 3, 5, 7, 9
}
```

---

## 六、defer 简介

`defer` 是 Go 独有的关键字，用于将函数调用延迟到**当前函数返回前**执行。

### 6.1 基本用法

```go
func readFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    // defer 确保文件在函数返回前关闭
    defer f.Close()

    // ... 读取文件内容 ...
    return nil
} // f.Close() 在这里执行
```

### 6.2 执行顺序——LIFO（后进先出）

```go
func main() {
    defer fmt.Println("第一个 defer") // 最后执行
    defer fmt.Println("第二个 defer") // 倒数第二个执行
    defer fmt.Println("第三个 defer") // 最先执行
    // 输出顺序: 第三个 -> 第二个 -> 第一个
}
```

### 6.3 defer + 匿名函数

```go
func process() {
    defer func() {
        // recover() 必须在 defer 中调用
        if r := recover(); r != nil {
            fmt.Println("捕获 panic:", r)
        }
    }()

    panic("出大事了!") // 匿名函数会在 panic 时执行
}
```

### 6.4 与 C++ RAII 的对比

| 特性 | C++ RAII | Go defer |
|------|----------|----------|
| 作用域 | 对象生命周期（作用域级别） | 函数返回前（函数级别） |
| 执行时机 | 离开作用域时 | 函数返回前 |
| 顺序 | 声明顺序的逆序（嵌套析构） | 声明顺序的逆序（LIFO） |
| 灵活性 | 析构函数逻辑固定 | 可以传递参数，编写任意清理逻辑 |
| 适用场景 | 通用资源管理 | 释放资源、关闭连接、解锁互斥锁 |

> **一句话理解**：`defer` 是 RAII 的函数级简化版。它没有 C++ 析构函数那样精细的作用域控制，但在函数级别的资源清理上同样方便。

### 6.5 defer 的参数求值时机

```go
func main() {
    x := 10
    defer fmt.Println(x) // x 的值在 defer 语句执行时就确定了（值为 10）
    x = 20
    // 输出: 10（不是 20！）

    // 如果需要延迟求值，用匿名函数：
    defer func() {
        fmt.Println(x) // 输出: 20（闭包捕获的是变量引用）
    }()
}
```

> **常见坑**：`defer` 语句中的参数是**立即求值**的，而匿名函数中的变量是**延迟求值**的（闭包引用）。

---

## 七、常见坑

### 坑 1：`if` 初始化语句的变量作用域

```go
var x int
if x := 10; x > 5 {
    fmt.Println(x) // OK, x = 10
}
fmt.Println(x) // OK, x = 0（外层的 x，不是 if 内部的）
```

> 两个 `x` 是不同的变量。`if` 内部用 `:=` 声明了新的 `x`，遮蔽了外层的 `x`。

### 坑 2：for range 的值是副本

```go
nums := []int{1, 2, 3}
for _, v := range nums {
    v = 100 // 这里修改的是副本，原切片不受影响
}
// nums 仍然是 {1, 2, 3}

// 正确做法：通过索引修改
for i := range nums {
    nums[i] = 100
}
```

### 坑 3：fallthrough 无条件穿透

```go
// Go 的 fallthrough 不检查下一个 case 的条件
switch 1 {
case 1:
    fmt.Println("one")
    fallthrough
case 2:
    fmt.Println("two") // 无论如何都会执行！即使 case 2 的条件不满足
}
```

### 坑 4：defer 在循环中累积

```go
// 错误示范：defer 在函数返回前才执行，大量文件句柄会累积
func processFiles(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close() // 所有文件直到函数结束才关闭！
    }
    // ...
    return nil
}

// 正确做法：用匿名函数封装，让 defer 在每次迭代结束时执行
func processFiles(paths []string) error {
    for _, p := range paths {
        if err := func(p string) error {
            f, err := os.Open(p)
            if err != nil {
                return err
            }
            defer f.Close() // 匿名函数返回时就关闭
            // ... 处理文件 ...
            return nil
        }(p); err != nil {
            return err
        }
    }
    return nil
}
```

### 坑 5：switch 中忘记 Go 用逗号分隔多个值

```go
// Go: 多个匹配值用逗号分隔
switch color {
case "red", "blue", "green": // 正确
    fmt.Println("primary color")
}

// 不要写成（C++ 风格）：
// case "red": case "blue": case "green": // 语法错误
```

---

## 八、练习任务

- [ ] **if 练习**：编写函数，接收 `error` 返回值，使用 `if err := ...; err != nil` 模式处理错误
- [ ] **for 练习**：用 `for range` 遍历一个 `map[string]string`，拼接所有 value 为逗号分隔的字符串
- [ ] **for range 练习**：用 `for range` 实现字符串反转（以 rune 为单位，处理中文字符）
- [ ] **switch 练习**：写一个 `switch` 语句，根据 HTTP 状态码（200/301/404/500）返回对应描述
- [ ] **type switch 练习**：编写 `describe(i interface{})` 函数，用 type switch 打印不同类型信息
- [ ] **defer 练习**：编写函数打开文件、defer 关闭、读取内容，体会 defer 的便捷
- [ ] **defer 进阶**：验证 defer 参数求值时机——预测代码输出并运行验证
- [ ] **标签练习**：用 `break Outer` 标签跳出嵌套循环，查找二维切片中的目标值

---

> 上一篇：[02-变量常量与类型](02-变量常量与类型.md) | 下一篇：[04-数组与切片](04-数组与切片.md)
