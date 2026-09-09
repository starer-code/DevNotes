# 02 - 错误处理：error / panic / recover

> 从 C++ 的 try/catch/throw 到 Go 的显式错误返回值、panic 与 defer+recover

---

## 一、简述

Go 的错误处理哲学和 C++ **完全相反**：不抛异常，而是把错误当作**普通返回值**显式传递。函数签名里直接写明"可能返回错误"，调用方必须处理。这套设计的核心目标：**错误路径在代码里一目了然，绝不静默吞掉**。

Go 提供三层错误机制：

| 机制 | 用途 | 类似 C++ |
|------|------|----------|
| `error` 返回值 | 可预期、应处理的错误（文件不存在、网络失败…） | 返回码 / `std::error_code` |
| `panic` | 不可恢复的严重错误（越界、空指针…） | `throw` |
| `recover` | 在 defer 中捕获 panic | `catch` |

> **核心要点**：能用 `error` 就不要 `panic`。`panic` 是"程序无法继续"的最后手段，`recover` 只用于极少数场景（如防止 goroutine 崩溃拖垮整个程序）。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 抛出错误 | `throw std::runtime_error("...")` | `return errors.New("...")` | Go 是返回值，不是跳转 |
| 捕获错误 | `try { } catch (const std::exception& e)` | `if err != nil { ... }` | Go 用 if 判断 |
| 错误类型 | 异常类层级 | `error` 接口 | Go 只有一个 error 接口 |
| 清理资源 | RAII / 析构 | `defer` | 函数级，非作用域级 |
| 致命错误 | `std::terminate` | `panic` | 都是不可恢复 |
| 兜底捕获 | `catch (...)` | `defer func() { recover() }()` | recover 必须在 defer 中 |
| 错误包装 | 异常嵌套 | `fmt.Errorf("%w", err)` | `%w` 支持解包判断 |

---

## 三、error 接口

Go 的 `error` 是一个**预定义接口**：

```go
type error interface {
    Error() string
}
```

任何实现了 `Error() string` 方法的类型都满足 `error` 接口。

### 3.1 创建错误

```go
import "errors"

// 方式一：errors.New —— 最常用
err := errors.New("连接超时")

// 方式二：fmt.Errorf —— 带格式化信息
name := "config.yaml"
err2 := fmt.Errorf("无法读取文件 %s", name)
```

### 3.2 标准错误处理模式

```go
// 函数返回 (值, error) —— Go 最典型的签名
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("除数不能为 0")
    }
    return a / b, nil  // 成功时 error 返回 nil
}

func main() {
    result, err := divide(10, 0)
    if err != nil {
        fmt.Println("出错了:", err)
        return
    }
    fmt.Println("结果:", result)
}
```

> **约定**：成功返回 `nil`；`err != nil` 时必须处理，不能忽略。

---

## 四、错误包装与解包

实际工程中，错误需要**带上上下文**（在哪一层、什么操作出的错），同时保留原始错误以便判断。

### 4.1 fmt.Errorf + %w 包装

```go
func readConfig(path string) error {
    f, err := os.Open(path)
    if err != nil {
        // %w 把原始错误包进来，err 同时携带上下文和原错误
        return fmt.Errorf("打开配置文件 %s 失败: %w", path, err)
    }
    defer f.Close()
    return nil
}
```

### 4.2 errors.Is / errors.As 判断

```go
import "errors"

func main() {
    err := readConfig("/no/such/file")

    // errors.Is：判断错误链中是否包含指定错误（== 比较或实现 Is 方法）
    if errors.Is(err, os.ErrNotExist) {
        fmt.Println("文件不存在")
    }

    // errors.As：把错误链中的某个类型提取出来
    var pathErr *os.PathError
    if errors.As(err, &pathErr) {
        fmt.Printf("路径错误: %s\n", pathErr.Path)
    }
}
```

> **对照 C++**：`errors.Is` ≈ `catch (const std::filesystem::filesystem_error& e)` 的层级匹配；`errors.As` ≈ `dynamic_cast` 抓具体类型。

### 4.3 自定义错误类型

```go
// 自定义错误：带状态码
type HTTPError struct {
    StatusCode int
    Message    string
}

func (e *HTTPError) Error() string {
    return fmt.Sprintf("HTTP %d: %s", e.StatusCode, e.Message)
}

// 可选：实现 Unwrap 支持错误链
// func (e *HTTPError) Unwrap() error { ... }

func fetch(url string) error {
    return &HTTPError{StatusCode: 404, Message: "Not Found"}
}

func main() {
    err := fetch("https://example.com/x")
    var he *HTTPError
    if errors.As(err, &he) {
        fmt.Printf("状态码: %d\n", he.StatusCode)  // 404
    }
}
```

---

## 五、panic 与 recover

### 5.1 panic —— 不可恢复的错误

```go
func main() {
    // 数组越界会自动 panic
    arr := []int{1, 2, 3}
    fmt.Println(arr[5])  // panic: runtime error: index out of range
}
```

显式触发 panic：

```go
func checkAge(age int) {
    if age < 0 {
        panic("年龄不能为负数")  // 程序崩溃，打印堆栈
    }
}
```

> **什么时候用 panic**：程序状态已损坏、无法继续正确执行（如配置缺失导致无法启动、前置条件被严重违反）。日常业务错误**一律用 error**。

### 5.2 recover —— 兜底捕获

```go
// recover 必须放在 defer 的匿名函数中才有效
func safeDivide(a, b int) (result int) {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("捕获到 panic:", r)
            result = -1  // 给返回值一个兜底值
        }
    }()

    if b == 0 {
        panic("除零")  // 触发 panic
    }
    return a / b
}

func main() {
    fmt.Println(safeDivide(10, 0))  // 捕获到 panic: 除零  /  -1
    fmt.Println("程序继续运行")        // 没有崩溃
}
```

### 5.3 defer 的执行时机（LIFO）

```go
func main() {
    defer fmt.Println("第 1 个 defer")  // 最后执行
    defer fmt.Println("第 2 个 defer")
    defer fmt.Println("第 3 个 defer")  // 最先执行
    // 输出: 第 3 个 -> 第 2 个 -> 第 1 个
}
```

---

## 六、常见坑

### 坑 1：忽略错误（最致命）

```go
// ❌ 反面：忽略错误
f, _ := os.Open("config.yaml")   // _ 丢弃错误
// 文件不存在时 f 是 nil，后续直接崩

// ✅ 正确：必须检查
f, err := os.Open("config.yaml")
if err != nil {
    log.Fatalf("打开失败: %v", err)
}
```

### 坑 2：defer 的参数立即求值

```go
func main() {
    x := 10
    defer fmt.Println(x)  // 立即求值，输出 10
    x = 20
    // 实际输出: 10（不是 20！）
}

// 如果需要延迟求值，用闭包：
// defer func() { fmt.Println(x) }()  // 输出 20
```

### 坑 3：defer 在循环中累积

```go
// ❌ 反面：循环里 defer，文件句柄全部堆积到函数结束才关闭
func processFiles(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close()  // 所有文件最后才关，句柄泄漏！
    }
    return nil
}

// ✅ 正确：把处理逻辑包进匿名函数，让 defer 每次迭代都执行
func processFiles(paths []string) error {
    for _, p := range paths {
        if err := func() error {
            f, err := os.Open(p)
            if err != nil {
                return err
            }
            defer f.Close()  // 匿名函数返回时就关闭
            // ... 处理文件 ...
            return nil
        }(); err != nil {
            return err
        }
    }
    return nil
}
```

### 坑 4：panic 后资源未释放

```go
func main() {
    f, _ := os.Open("data.txt")
    // ❌ 如果下面 panic，f 永远不会被关闭
    // defer f.Close()  // ✅ 正确：defer 在 panic 时也会执行！
    panic("oops")
}
```

> **defer 在 panic 时照样执行**——这正是 defer 的威力，等于 C++ 的 RAII 兜底。

### 坑 5：recover 的返回值理解错误

```go
func main() {
    defer func() {
        r := recover()
        // r 是 panic 传入的值（任何类型），不是 error
        fmt.Printf("类型: %T, 值: %v\n", r, r)
    }()
    panic("something bad")          // r = "something bad"
    // panic(errors.New("x"))       // r = error 值
    // panic(42)                    // r = 42
}
```

---

## 七、练习任务

- [ ] 写一个 `ParseInt(s string) (int, error)`，对非法输入返回带说明的错误，并在 main 中正确处理
- [ ] 用 `fmt.Errorf("%w", err)` 包装三层函数调用的错误，再用 `errors.Is` 判断底层错误是否为 `os.ErrNotExist`
- [ ] 定义一个带 `Code int` 的自定义错误类型，用 `errors.As` 提取并打印 Code
- [ ] 写一个 `safeExec(fn func())` 函数，内部用 defer+recover 捕获 panic 并打印堆栈（`debug.Stack()`），程序不崩溃
- [ ] 复现"坑 3"的句柄泄漏，改成匿名函数包裹的版本，并说明两者行为差异
- [ ] 阅读标准库 `os` 包中 3 个返回 error 的函数签名，总结 Go 错误处理的惯例

---

## 八、本节要点速查

| 概念 | 要点 |
|------|------|
| error 接口 | `Error() string`，任何实现它的类型都是 error |
| 创建错误 | `errors.New("...")` / `fmt.Errorf("...%v", x)` |
| 错误约定 | 成功返回 `nil`；`err != nil` 必须处理，不能忽略 |
| 错误包装 | `fmt.Errorf("...: %w", err)` 保留原始错误链 |
| 判断错误 | `errors.Is(err, target)` 判等、`errors.As(err, &target)` 取类型 |
| 自定义错误 | 实现 `Error()`，可加 `Code` 等字段；可选 `Unwrap()` |
| panic | 不可恢复错误（越界、前置条件破坏）；业务错误别用 |
| recover | 必须在 `defer` 的匿名函数里调用；返回 panic 传入的值 |
| defer 特性 | LIFO 执行；panic 时照样执行；参数立即求值 |
| 大坑 | 忽略错误、循环里 defer 句柄泄漏、defer 参数立即求值 |

> 上一篇：[01-接口interface](01-接口interface.md) | 下一篇：[03-泛型generics](03-泛型generics.md)
