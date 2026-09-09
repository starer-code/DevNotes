# 08 - 数据竞争与 race 检测

> C++ 的 TSan / helgrind 你在用，Go 内置了一个更好使的：`go run -race` 一键找数据竞争

---

## 一、简述

**数据竞争（data race）**：两个或多个 goroutine **并发访问同一内存位置**，且**至少一个是写操作**，且没有任何同步（锁 / channel / 原子操作）约束它们之间的顺序。数据竞争的结果是**未定义行为**（UB）：读到撕裂值、编译器优化后行为诡异、crash、或者——最恼人的——**偶尔才出错**。

C++ 里你熟知的工具：**ThreadSanitizer（TSan）**、`-fsanitize=thread`、helgrind。Go 的对应物是内置的 **race detector**：

```bash
go run -race   main.go       # 直接跑并检测
go test -race  ./...          # 测试时检测（推荐）
go build -race  main.go       # 构建带检测的二进制（性能有损，仅调试）
```

> **核心要点**：Go race detector 不是「预防工具」，而是「**逮现行犯**」的探针——它监测每个内存访问，报告「两个 goroutine 同时访问同一地址」的现场。**加了 -race，不等于程序没问题；没加 -race，问题照样存在。** 修复手段三件套：Mutex、atomic、channel 传值。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 数据竞争定义 | 两个线程无同步访问同一地址 | 同，goroutine 版 | 语义一致：至少一写 + 无同步 |
| 检测工具 | TSan / `-fsanitize=thread` / helgrind | `go run -race` / `go test -race` | Go **内置**，零配置，一行参数 |
| 检测原理 | 影子内存 + happens-before 分析 | 同样基于 happens-before 的 shadow 内存 | 实现同源（Go 4 个字节内存配 8 字节影子） |
| 共享计数器 | `std::atomic<int>` / mutex | `atomic.AddInt64`（首选） | Go 原子 / 锁 / channel 三种解法都有 |
| map 并发写 | `std::unordered_map` + mutex | **map 并发写 = 直接 panic** | Go 有额外保护：写中读/写检测 |
| 修复手段 | 锁 / 原子 / 无共享 | Mutex / atomic / channel 传值 | 第三种（传值）是 Go 特色 |
| 内存模型文档 | cppreference memory_order | [The Go Memory Model][go-mem] | Go 文档短得多，先读「happen-before」 |
| 检测开销 | 慢 5~15 倍 | 运行慢 5~10 倍，内存多 5~10 倍 | 都只该在测试/CI 用 |

[go-mem]: https://go.dev/ref/mem

---

## 三、逐主题详解

### 3.1 什么是数据竞争

判定为数据竞争需要三条同时成立：
1. **同一内存位置**；
2. **至少一个 goroutine 在写**（两个都读不是竞争）；
3. **两者之间没有同步关系**（没有锁、没有 channel 通信、没有原子操作约束先后）。

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var counter int // 共享变量

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // ❌ 10 个 goroutine 同时写 counter，且无同步
        }()
    }
    wg.Wait()
    fmt.Println("counter =", counter) // 结果不确定（往往 < 10）
}
```

即使你「等所有 goroutine 结束」再读（wg.Wait），`counter++` 之间依旧互相竞争——`++` 是「读-改-写」，两个 goroutine 的读-改之间没有任何 happens-before 边。

### 3.2 用 `-race` 逮住它

把上面的文件命名为 `race_demo.go`，然后：

```bash
go run -race race_demo.go
```

会输出类似：

```
==================
WARNING: DATA RACE
Read at 0x00c0000c0108 by goroutine 7:
  main.main.func1:6
  ...
Previous write at 0x00c0000c0108 by goroutine 6:
  main.main.func1:6
  ...
==================
```

**报告结构**：读在 `Read at`、写在 `Previous write at`，各带 goroutine 栈。它告诉你**哪里发生的、哪些 goroutine**。这是第一手调试材料——定位后按 3.4~3.6 修复。

> ⚠️ **C++ 对照**：TSan 报告格式是 `WARNING: ThreadSanitizer: data race` + 两个栈；Go race detector 更简洁，且**对 slice/map/string 的 header 访问也检测**，覆盖面更细。

### 3.3 典型场景：共享计数器、map 并发写

**（1）共享计数器** —— 上面 3.1 已演示。修复用 `atomic.AddInt64`：

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var counter atomic.Int64 // ✅ 原子变量，消除竞争

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("counter =", counter.Load()) // 一定 10
}
```

> **C++ 对照**：等价 `std::atomic<int64_t>`，语义与修复方式完全一致。

**（2）map 并发写 —— Go 会主动 panic**：

```go
package main

import "sync"

func main() {
    m := make(map[string]int)
    var wg sync.WaitGroup

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            m["key"] = i // ❌ 并发写 map：不修会 panic
        }()
    }
    wg.Wait()
    _ = m
}
```

运行会直接：`fatal error: concurrent map writes`。**Go 的 map 对并发写有运行时检测**——只要检测到并发读写 / 写写，直接 fatal，不等你发现数据错乱。这是比 C++ 更激进的安全设计。修复：加 Mutex，或用 `sync.Map`，或分片 map。

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var (
        mu sync.Mutex
        m  = make(map[string]int)
    )
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            mu.Lock()
            m["key"] = i // ✅ 锁保护
            mu.Unlock()
        }(i)
    }
    wg.Wait()
    fmt.Println(m) // map[key:4]（最后一次写入者胜出）
}
```

**（3）slice append 并发**：

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var (
        mu  sync.Mutex
        vec []int
    )
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            mu.Lock()
            vec = append(vec, i) // ✅ 并发 append 也要锁
            mu.Unlock()
        }(i)
    }
    wg.Wait()
    fmt.Println(len(vec)) // 100
}
```

> ⚠️ 并发 `append` 未用锁时，可能触发内部切片扩容的 header 读写竞争——race detector 一定抓得到，别侥幸。

### 3.4 修复手段一：Mutex 保护临界区（多字段 / 复杂状态）

```go
package main

import (
    "fmt"
    "sync"
)

type Account struct {
    mu    sync.Mutex
    bal   int
    owner string
}

func (a *Account) Deposit(n int) {
    a.mu.Lock()
    defer a.mu.Unlock() // RAII 式解锁
    a.bal += n
    // bal 和 owner 的「组合一致性」由同一把锁保证
}

func (a *Account) Balance() int {
    a.mu.Lock()
    defer a.mu.Unlock()
    return a.bal
}

func main() {
    acc := &Account{owner: "alice"}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); acc.Deposit(1) }()
    }
    wg.Wait()
    fmt.Println("余额:", acc.Balance()) // 1000
}
```

**适用**：临界区处理多个字段、集合、或步骤间要保持一致的逻辑。锁把「多步暴露在竞态下」的一段代码整体原子化。

### 3.5 修复手段二：atomic（单变量 / 高频）

计数器、标志位、版本号等**单变量高频访问**，用原子最划算（见 `[[05-atomic原子操作]]`）。

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var hits atomic.Int64
    var wg sync.WaitGroup

    // 并发打点
    for i := 0; i < 50; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            hits.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("总命中:", hits.Load()) // 50
}
```

**选型口诀**：**单变量 → atomic；多字段/复杂临界区 → Mutex。**

### 3.6 修复手段三：channel 传值（Go 特色——不共享它）

Go 风格：**把「共享」变成「传递」**。数据从一个 goroutine 交给另一个，由 channel 建立 happens-before，根本不出现「同一块内存同时读写」。

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int, 100)
    results := make(chan int, 100)

    // 两个消费者：数据经 channel 流动，无共享内存
    var wg sync.WaitGroup
    for w := 0; w < 2; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for n := range jobs { // 从 channel 拿值 = 建立 happens-before
                results <- n * n
            }
        }()
    }

    for i := 1; i <= 10; i++ {
        jobs <- i // 传值（拷贝），不是共享
    }
    close(jobs)

    wg.Wait()
    close(results)
    for r := range results {
        fmt.Println(r)
    }
}
```

**为什么这能消灭数据竞争**：channel 的发送 / 接收构成一对 **happens-before**——发送方的一系列操作（写入、计算）在接收方拿到值之前**全部完成且可见**；而且每个任务只被一个消费者取走，不存在两段同时访问。

> **C++ 对照**：C++ 用 `std::move` + shared_ptr 或消息传递库（`std::async` 那套）模拟「传值」；Go channel 把「传值 + 同步」做成语言特性，团队里照这个模式写，数据竞争从源头消失。

### 3.7 Go 内存模型（一句话入门）

Go 语言规范有一份 [The Go Memory Model](https://go.dev/ref/mem)，核心概念是 **happens-before（先于关系）**：

> **如果操作 A happens-before 操作 B，那么 B 能观察到 A 的全部效果。**

用来建立 happens-before 的「同步事件」：
- `go` 语句启动 goroutine：`go f()` 先于 f 内所有语句；
- channel 发送 precedes 对应接收；
- `close(ch)` precedes 从 ch 读到「关闭」；
- Mutex 的 `Unlock` precedes（同一把锁的）后续 `Lock`；
- `WaitGroup.Wait` 返回 happens-after 所有 `Done`；
- 原子操作（`sync/atomic`）提供读写之上的基本约束。

**实用推论**：race detector 报告「有竞争」，就说明「两条路径之间没有任何 happens-before」；你补上的任何锁 / channel / 原子操作，本质就是**在缺口上焊一条 happens-before 边**。

### 3.8 完整工作流：修复报告

```bash
# 1. 写好的并发代码
go build -race -o app.exe app.go   # 或直接跑
go run -race app.go

# 2. 单元测试全量检测（比临时跑更可靠）
go test -race ./...

# 3. CI 里常驻：-race + -cover，一起跑
```

遇到 warning 的排查步骤：
1. 读 `Read at` / `Previous write at` 两个栈，确定双 goroutine 的碰撞点；
2. 想清楚「这两个 goroutine 之间有没有同步层？」；
3. 按「单变量→原子；多字段→锁；能传值→ channel」选择修复；
4. 重新 `-race` 验证报告消失。

---

## 四、常见坑与误区

### 坑 1：以为「结果碰巧是对的」就没数据竞争

**现象**：跑几次输出都对，就把 `counter++` 留在线上。
**原因**：数据竞争是 UB，结果为「恰好不错」纯属运气；换 CPU / 负载 / 编译器可能瞬间崩。
**正确写法**：并发代码起步就用 `go test -race`；任何「共享 + 并发」先想同步。

### 坑 2：「我有 wg.Wait() 收尾，所以前面都安全」

**现象**：共享变量在 goroutine 里乱写，最后 `wg.Wait()` 再读，还是不放心地查——竞争发生在**并发阶段**，不是收尾阶段。
**原因**：`Wait` 只保证「收尾顺序」，救不了中间的交错。
**正确写法**：每个**写**都要和并发读 / 写之间建 happens-before；靠 `Wait` 收尾 ≠ 解除竞争。

### 坑 3：以为 `-race` 检查过 = 没有数据竞争

**现象**：`go run -race` 干净通过就上线。
**原因**：race detector 是**抽样式曝光**——只有「两个 goroutine 真正重叠访问」时才会被抓到；没跑到那条时间线就检测不到。检测通过只能说「这次没抓到」，不能证明「没有」。
**正确写法**：把 `-race` 放 CI + 覆盖并发主干路径；同时遵循「能用原子/锁/channel 就别共享」的设计。

### 坑 4：map 并发写只 panic 在「写 vs 写」，读 vs 写要 -race 才暴露

**现象**：只测试写写时 panic 了，以为读读就没问题；线上读多写少的缓存偶尔诡异幂等失败。
**原因**：map 的运行时保护是尽力而为（写检测），读与写并发是**未被当场逮住**但依旧 UB。
**正确写法**：map 一律只由「持有锁的代码 / 单 goroutine」访问；多读场景用 `sync.RWMutex` 或 `atomic.Pointer[map]` 快照。

### 坑 5：用「临时 sleep 让队友先跑」代替同步

**现象**：`time.Sleep(100ms)` 等初始化线程跑完再 use。
**原因**：sleep 不建立 happens-before；只是靠「概率」侥幸不错位。
**正确写法**：用 channel / WaitGroup / Mutex 建立真正的同步；sleep 只用于 so 慢环境，且不解决正确性。

### 坑 6：atomic 与普通读写混用，以为隔离

**现象**：原子写 `Store`，另一处却用 `m.bal = 1` 裸写；认为「部分原子」就够了。
**原因**：裸读写之间没有原子保证，竞争照样发生。
**正确写法**：同一变量一律走「读 Load / 写 Store / 改 Add 或 CAS」，不要混用（`[[05-atomic原子操作]]` 坑 2）。

### 坑 7：C++ 习惯「对象拷贝保护，写时拷」在 Go 不适配

**现象**：以为「传 struct 值」就能躲过竞争——结构体里塞了 slice/map 时，**header 引用同一底层数组**，传值不深拷贝，竞争依旧。
**原因**：Go 的 slice/map 是引用语义；「值传递」不等于「隔离数据」。
**正确写法**：要么显式深拷贝（`append(dst[:0], src...)`、`maps.Clone`），要么通道传值明确所有权；共享引用型数据必须上同步。

---

## 五、练习任务

- [ ] 写一个「10 个 goroutine 并发 `counter++`」的程序，用 `go run -race` 抓出报告，再用 atomic 修复并确认报告消失
- [ ] 复现「并发写 map」的 panic，把 `fatal error: concurrent map writes` 截下来，再用 Mutex 修复
- [ ] 把 C++ 里用 TSan（`-fsanitize=thread`）演示过的一个 data race 例子，改写为 Go 版并用 `go run -race` 复现同样报告，对比两个工具的报错格式
- [ ] 用 channel 传值改造一个「共享计数器」程序：计数器由单一 goroutine 持有，其他 goroutine 发消息给它增减，验证无竞争
- [ ] 写一个「并发 append 到 slice」未加锁的样例，用 `-race` 观察 header 竞争，再加锁修复
- [ ] 设计一个「读多写少」的配置热更新：写者 atomic.Pointer 替换快照，多个读者并发 Load，最后 `-race` 验证干净
- [ ] （进阶）读完 The Go Memory Model 的 happens-before 章节，用一段话标注你修复的每个竞争对应哪一条 happens-before 规则

---

## 六、延伸与参考

- [The Go Memory Model](https://go.dev/ref/mem)（happens-before 权威定义）
- [The Go Blog - Introduction to the Go Race Detector](https://go.dev/blog/race-detector)（race detector 使用手册）
- [go test 的 -race 参数文档](https://pkg.go.dev/cmd/go#hdr-Testing_flags)
- 相关笔记：[[04-sync包-WaitGroup-Mutex-Once]]、[[05-atomic原子操作]]、[[02-channel详解]]、[[07-并发模式-workerpool-扇入扇出-pipeline]]