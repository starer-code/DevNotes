# 01 - goroutine

> Go 并发的基本执行单元：比线程轻量十倍的绿色协程，由 Go 运行时调度

---

## 一、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 并发执行单元 | `std::thread` | `go func()` | goroutine 由运行时管理，不映射到 OS 线程 |
| 创建成本 | ~1MB 栈 + 系统调用 | ~2KB 栈，动态增长 | goroutine 创建成本极低，可轻松创建上万 |
| 启动方式 | `std::thread t(func); t.join();` | `go func()` | Go 无需手动 join，用 channel/WaitGroup 同步 |
| 调度模型 | 1:1 映射 OS 线程 | M:N 调度（GMP 模型） | 运行时把 N 个 goroutine 调度到 M 个线程上 |
| 栈大小 | 固定（通常 1~8MB） | 初始 2KB，按需增长/收缩 | 同一地址空间下可容纳海量 goroutine |
| 终止方式 | thread 析构或 detach | 主 goroutine 结束则全部退出 | goroutine 是 "fire and forget" |

> **核心要点**：goroutine 是 Go 并发的基石。创建一个 goroutine 只用一个 `go` 关键字，运行时自动处理调度、栈管理和线程复用。但 goroutine 之间需要通过 **channel** 或 **sync 包** 同步，否则会出现数据竞争。

---

## 二、启动 goroutine

### 2.1 基本语法

```go
package main

import (
    "fmt"
    "time"
)

func sayHello(name string) {
    for i := 0; i < 3; i++ {
        fmt.Printf("[%s] hello %d\n", name, i)
        time.Sleep(100 * time.Millisecond)
    }
}

func main() {
    go sayHello("goroutine-1")  // 启动一个 goroutine
    go sayHello("goroutine-2")  // 再启动一个

    sayHello("main")            // main 本身也是一个 goroutine
}
```

> ⚠️ 上面程序**可能不输出** goroutine 的内容——main 函数结束后，所有 goroutine 被强制终止，不会等它们跑完。

### 2.2 启动匿名函数（含经典陷阱）

```go
func main() {
    // 启动匿名 goroutine
    go func() {
        fmt.Println("Hello from anonymous goroutine")
    }()

    // ⚠️ 经典陷阱：循环变量捕获
    for i := 0; i < 5; i++ {
        go func() {
            fmt.Println(i) // ❌ 旧版本大概率全输出 5（闭包捕获的是变量 i 本身）
        }()
    }

    // ✅ 正确写法：显式传参
    for i := 0; i < 5; i++ {
        go func(n int) {
            fmt.Println(n) // ✅ 输出 0~4
        }(i)
    }

    time.Sleep(time.Second) // 仅演示用；真实代码不要用 sleep 等待
}
```

> **对照 C++**：C++11 lambda `[i]` 按值捕获是 `[i]`；Go 1.22+ 的 for 循环每次迭代是新变量，陷阱已消除。但为兼容旧版本且意图清晰，**显式传参仍是最佳实践**。

---

## 三、等待 goroutine 完成

goroutine 异步启动，main 一退出全部终止。正确等待有三种方式：

### 3.1 time.Sleep（仅演示，不推荐）

```go
func main() {
    go func() { fmt.Println("do work") }()
    time.Sleep(time.Second) // 等 1 秒，猜 goroutine 能跑完
    // ❌ 不可靠：不知道 goroutine 到底要多久
}
```

### 3.2 sync.WaitGroup（无需返回值时首选）

```go
import "sync"

func main() {
    var wg sync.WaitGroup

    for i := 0; i < 5; i++ {
        wg.Add(1)                 // 计数器 +1
        go func(n int) {
            defer wg.Done()        // 计数器 -1（defer 保证执行）
            fmt.Printf("worker %d\n", n)
        }(i)
    }

    wg.Wait()                     // 阻塞，等计数器归零
    fmt.Println("all done")
}
```

**C++ 对照**：`std::thread::join` 只能等**单个**线程；`WaitGroup` 一次等一批 goroutine，类似 `join_all`（或 C++ 的 `std::barrier`）。

> ❗ WaitGroup 使用要点：`Add` 必须在 `go` **之前**调用，否则 `Wait` 可能提前返回；`Done` 用 `defer` 包住，防止函数中途 return 漏减导致死锁。

### 3.3 channel（等待结果 / 同步数据）

```go
func worker(id int, out chan<- string) {
    // 把结果发到 channel
    out <- fmt.Sprintf("worker %d finished", id)
}

func main() {
    results := make(chan string, 5)  // 带缓冲，避免阻塞
    for i := 0; i < 5; i++ {
        go worker(i, results)
    }
    // 收 5 条结果 = 等 5 个 goroutine 完成
    for i := 0; i < 5; i++ {
        fmt.Println(<-results)
    }
}
```

Channel 既是同步工具又是数据通道，是 Go 并发最核心的通信方式。**下一节笔记专门讲 channel**，这里先用它收结果。

---

## 四、常见坑与误区

### 坑 1：main 结束 → goroutine 随进程一起死

```go
func main() {
    go func() { time.Sleep(1 * time.Second); fmt.Println("done") }()
    // main 直接返回，上面的 goroutine 大概率根本没执行完
}
```

**现象**：有时输出 `done`、有时不输出，运行结果不稳定。
**原因**：Go 程序在 `main` 返回时直接退出，不等待任何遗留 goroutine（没有进程级的 `join`）。
**正确写法**：用 `sync.WaitGroup` 或 channel 显式等所有 goroutine 收尾后再返回 `main`。

### 坑 2：循环变量被闭包捕获（Go 1.22 之前）

```go
for i := 0; i < 5; i++ {
    go func() { fmt.Println(i) }() // ❌ 大概率全打 5
}
```

**现象**：期望打印 0~4，实际打出一串 5（或随机几个数字）。
**原因**：闭包捕获的是变量 `i` 本身，不是每次迭代的值；旧版本 for 循环复用同一个变量，goroutine 真正执行时 `i` 已经是 5。
**正确写法**：`go func(n int) { fmt.Println(n) }(i)` 显式传参（Go 1.22+ 循环变量每次迭代是新变量，陷阱已消除，但显式传参仍是最清晰的做法）。

### 坑 3：WaitGroup 的 Add 与 go 顺序颠倒

```go
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    go func() { wg.Add(1); defer wg.Done(); ... }() // ❌ Add 在 goroutine 内部
}
wg.Wait() // 可能立即通过
```

**现象**：`wg.Wait()` 早早返回，任务还没跑完。
**原因**：`Add` 必须在 `go` 之前调用，否则 `Wait` 可能先看到计数器为 0。
**正确写法**：`wg.Add(1)` 写在各 goroutine 启动的循环体里、`go` 之前；`Done` 用 `defer` 包住防漏。

### 坑 4：panic 的 goroutine 会杀掉整个进程

```go
go func() { panic("boom") }() // 未 recover → 进程级崩溃
```

**现象**：一个 goroutine panic，整个程序崩溃退出。
**原因**：panic 若无 `recover` 捕获，会向全进程传播（不像 C++ 的线程异常可只在线程内处理）。
**正确写法**：在 goroutine 入口用 `defer func() { if r := recover(); r != nil { log.Printf("recovered: %v", r) } }()` 兜底。

### 坑 5：把 goroutine 当线程用——锁、栈大小、线程数

C++ 习惯「创建线程 = 昂贵资源，复用线程池」；Go 里 goroutine 初始栈仅 ~2KB、可动态增长，创建数十万也常见。别把 goroutine 当稀缺资源省着用；也记住**它不是 OS 线程**，阻塞在同步 IO / 死循环时不会自动补线程（这会间接增加 P 上的调度停顿）。

---

## 五、练习任务

- [ ] 用 `go func` + `sync.WaitGroup` 写一个「并发打印 1~10」的程序，跑通 `go run` 确认顺序可控
- [ ] 复刻「循环变量捕获」的两种写法（错误 + 显式传参），输出对照，理解闭包捕获语义
- [ ] 写一个并发求和：把一个大切片分成 4 段，4 个 goroutine 各算一段，channel 汇总，对比单线程结果
- [ ] 把 C++ 里用 `std::thread` + `std::atomic` 写的一个并发计数器，改写为 Go 版（goroutine + `sync/atomic`），比较心智负担
- [ ] 故意在 goroutine 里 panic，分别验证「不 recover 崩溃」和「recover 兜底」，并在注释里说明为什么
- [ ] 用 `go run -race` 跑「多个 goroutine 写同一个 map」的程序，观察 race 报告，再用 Mutex 修复

---

## 六、延伸与参考

- [A Tour of Go - Goroutines](https://go.dev/tour/concurrency/1)
- [The Go Memory Model](https://go.dev/ref/mem)（理解 goroutine 间可见性）
- 相关笔记：[[02-channel详解]]、[[04-sync包-WaitGroup-Mutex-Once]]、[[07-并发模式-workerpool-扇入扇出-pipeline]]
