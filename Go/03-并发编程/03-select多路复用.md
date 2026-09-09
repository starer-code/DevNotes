# 03 - select 多路复用

> 一个 goroutine 同时监听多个 channel 的「事件循环」：C++/epoll 监听多个 fd 的那个心智模型，Go 把它内建成了 select 语句

---

## 一、简述

`select` 是 Go 语法层面的**多路复用（multiplexing）**原语：它让一个 goroutine 同时**等待多个 channel 上的收发操作**，只要其中一个就绪，就走对应的分支。

对于 C++ 开发者，最贴切的类比是 **Linux epoll / poll**：你不想为每个 socket 各开一个线程去阻塞读，而是用一个线程同时监听一堆 fd，哪个有事件处理哪个。`select` 就是「 goroutine 版本的 epoll」——但它更进一步：它还能同时做**非阻塞尝试**（default）、**定时超时**（`time.After`）、**动态禁用分支**（nil channel）。

> **核心要点**：`select` 是「组合 channel 为复杂同步逻辑」的胶水。没有 select，一个 goroutine 只能死等一个 channel；有了 select，你才能写超时、写取消、写事件循环、写多路汇流。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 多路监听 | `epoll_wait(fds, ...)` / `poll()` | `select { case <-ch1: ... }` | Go 是对 channel 通道复用，C++ 是对 fd 复用 |
| 同时等两个事件 | 一个线程一个 fd 各睡一觉 / epoll | 一个 goroutine 同时等多个 case | `select` 内建，代码直白得多 |
| 随机公平选择 | epoll 按就绪顺序返回 | 多 case 就绪时**随机**选一个 | Go 保证公平：随机而非先后 |
| 非阻塞尝试 | `poll(fd, timeout=0)` | `select { case ...: default: }` | `default` = 都不就绪立即走 |
| 超时等待 | `epoll_wait` 的 timeout 参数 | `select` + `time.After(1s)` | 超时是普通 channel，不是特殊机制 |
| 收发都监听 | 读 / 写事件分别注册 | 一个 select 里既有发送又有接收 case | 语法上收发对称 |
| 监听无限器 | 服务端 accept 线程循环 | `for { select { ... } }` | 事件循环惯用法 |
| 特定事件暂时屏蔽 | 取消注册 fd | case 的 channel 置 nil → 永久阻塞 | **nil channel 妙用** |

---

## 三、逐主题详解

### 3.1 select 基本语法

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch1 := make(chan string)
    ch2 := make(chan string)

    // 两个 goroutine 各自往不同 channel 发
    go func() { time.Sleep(100 * time.Millisecond); ch1 <- "来自 ch1" }()
    go func() { time.Sleep(300 * time.Millisecond); ch2 <- "来自 ch2" }()

    // select 会阻塞，直到某个 case 就绪
    select {
    case msg := <-ch1:
        fmt.Println("收到:", msg) // 大概率先到 ch1（100ms 更快）
    case msg := <-ch2:
        fmt.Println("收到:", msg)
    }
}
```

**要点**：
- `select` 的每个 `case` 必须是**通道收发表达式**（不能是任意条件）。
- 只要一个 case 就绪就执行它，然后整个 `select` 结束。
- 多个 case 同时就绪时，**随机公平**挑选（见 3.2）。

### 3.2 多 case 就绪 → 随机公平选择

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    close(ch) // 关闭的 channel 无论收发永远立即就绪

    // 三个 case 全部立刻可执行，select 随机选一个
    for i := 0; i < 10; i++ {
        select {
        case <-ch:
            fmt.Println("case 1")
        case <-ch:
            fmt.Println("case 2")
        case <-ch:
            fmt.Println("case 3")
        }
    }
}
```

运行它会看到 `case 1 / 2 / 3` 大致均匀随机出现。**Go 保证公平性**——不会饿死任何一个 case。C++ 里你只能靠事件顺序或自己加计数器去模拟「公平」，Go 直接给你。

> ⚠️ **C++ 对照**：`select` 的随机性意味着**别假设分支执行顺序**。C++ 里事件按到达顺序处理，Go 里同时就绪时是丢骰子——需要严格顺序时，请走单 channel + 序号，或串行化。

### 3.3 `default` 分支实现非阻塞

```go
package main

import "fmt"

func main() {
    ch := make(chan int)

    // select + default = 非阻塞尝试，像 try_lock
    select {
    case v := <-ch:
        fmt.Println("收到:", v) // ch 上没人发，不执行
    default:
        fmt.Println("ch 当前无数据可收，走 default（不阻塞）")
    }

    // 带缓冲 + 已满时的非阻塞发送
    full := make(chan int, 1)
    full <- 1 // 占满
    select {
    case full <- 99:
        fmt.Println("发送成功")
    default:
        fmt.Println("缓冲已满，立即返回，不发送")
    }
}
```

`default` 的价值：**非阻塞收发**。配合 `for` 可以做成「能收就收，收不到就去做别的」的轮询循环。

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 3)
    go func() {
        for i := 1; i <= 3; i++ {
            ch <- i
            time.Sleep(50 * time.Millisecond)
        }
    }()

    for i := 0; i < 5; i++ {
        select {
        case v := <-ch:
            fmt.Println("拉到:", v)
        default:
            fmt.Println("暂时没货，先干点别的")
        }
        time.Sleep(100 * time.Millisecond)
    }
}
```

### 3.4 `select` + `for`：事件循环

这是服务和后台任务最常用的形态——一个 goroutine 永远在循环里监听多个事件源。

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    stop := make(chan struct{})      // 关闭该 channel → 广播停止
    dataCh := make(chan int, 10)

    // 生产者
    go func() {
        for i := 1; i <= 5; i++ {
            dataCh <- i
            time.Sleep(80 * time.Millisecond)
        }
    }()

    // 消费者：事件循环，监听两个 channel
    go func() {
        for {
            select {
            case v := <-dataCh:
                fmt.Println("处理数据:", v)
            case <-stop:
                fmt.Println("收到停止信号，退出循环")
                return // 只有 return 才能真正退出死循环
            }
        }
    }()

    time.Sleep(500 * time.Millisecond)
    close(stop) // 广播停止
    time.Sleep(100 * time.Millisecond)
    fmt.Println("main 结束")
}
```

> **C++ 对照**：相当于 `while (running) { epoll_wait(...); switch(event) {...} }`。Go 的 `select` 把「等事件」和「分发」写进一条语句，且 `case <-stop` 就是标准的「停止令牌」。C++ 里这种反模式通常用 `std::atomic<bool>` + 轮询 + `condvar` 通知，繁琐得多。

### 3.5 配合 `time.After` 实现超时

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan string)

    // 一个可能永远不返回值的 slow 操作
    go func() {
        time.Sleep(3 * time.Second)
        ch <- "终于好了"
    }()

    select {
    case msg := <-ch:
        fmt.Println("在期限内收到:", msg)
    case <-time.After(1 * time.Second): // 1 秒超时
        fmt.Println("超时了！不等这个慢操作了")
    }
    // 注意：慢操作的 goroutine 还在后台继续，最终写 channel 也不会有接收方——
    // 无缓冲 channel 上它会一直阻塞……这是「goroutine 泄漏」隐患（见坑 5）
}
```

`time.After(d)` 返回一个 channel，到点后收到一个 `time.Time`。在 `select` 里它就是「超时闹钟」。

### 3.6 配合 `time.Tick` 做周期任务

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    stop := make(chan struct{})

    go func() {
        ticker := time.NewTicker(200 * time.Millisecond) // 每 200ms 发一次
        defer ticker.Stop() // ticker 需要手动 Stop 释放

        for {
            select {
            case t := <-ticker.C:
                fmt.Println("tick:", t.Format("15:04:05.000"))
            case <-stop:
                fmt.Println("停止")
                return
            }
        }
    }()

    time.Sleep(900 * time.Millisecond)
    close(stop)
    time.Sleep(50 * time.Millisecond)
}
```

> ⚠️ 对比 `time.After` 与 `time.NewTicker`：`After` 一次性、用后即弃；`Ticker` 循环触发、**用完必须 `Stop()`**，否则会泄漏底层定时器。

### 3.7 空 `select {}` 永久阻塞

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    go func() {
        fmt.Println("后台 goroutine 在跑")
        time.Sleep(300 * time.Millisecond)
        fmt.Println("统计 goroutine 数:", runtime.NumGoroutine())
    }()

    fmt.Println("main 用空 select 永久阻塞，等里面的 goroutine 干活")
    <-time.After(400 * time.Millisecond)
    fmt.Println("下面对比：select{} 才是真永久阻塞……")
    select {} // 没有任何 case：永远阻塞，且没有任何 receive/send 可做
}
```

`select {}` 没有 case，永远不会有分支就绪 → **永久阻塞**。常用场景：
1. `main` 函数最后让服务永远跑着（但实际项目一般用别的机制 + 信号处理）。
2. 故意挂起一个 goroutine。

> ⚠️ 注意：单独 `select {}` 在主 goroutine 会触发运行时死锁检测 panic；在非主 goroutine 里则真的「永睡」，要小心用它（常见于「wait forever」的占位）。

### 3.8 从已关闭的 channel 上 case 永远就绪（死循环陷阱）

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)
    go func() {
        ch <- 1
        ch <- 2
        close(ch) // 关闭
    }()

    for {
        select {
        case v, ok := <-ch:
            if !ok {
                fmt.Println("channel 已关闭，退出循环")
                return // 必须显式退出，否则 select 会反复命中已关闭的 case
            }
            fmt.Println("处理:", v)
        default:
            // 无关紧要：重点是上面 ok==false 必须 return
        }
        time.Sleep(20 * time.Millisecond)
    }
}
```

**关键**：已关闭 channel 的接收 case 永远「就绪」，且永远返回 `(零值, false)`。如果代码里只用 `case v := <-ch` 而**不检查 `ok`**，会导致 select 疯狂空转。务必用 `v, ok := <-ch` 判断关闭。

### 3.9 select 的「发送 case」：对称语法

`select` 不仅能等待**接收**，也能等待**发送**——发送能否成功本身就是一个「事件」。

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    // 消费者每 150ms 才来取一次货
    ch := make(chan int, 2)
    go func() {
        for i := 1; i <= 3; i++ {
            time.Sleep(150 * time.Millisecond)
            fmt.Println("消费者取走:", <-ch)
        }
    }()

    // 生产者用 select 发：缓冲没满或消费者就绪才发成功，否则重试
    for i := 1; i <= 6; i++ {
        for {
            select {
            case ch <- i:
                fmt.Printf("已投递 %d\n", i)
                goto next // 投递成功，处理下一个 i
            case <-time.After(10 * time.Millisecond):
                fmt.Println("缓冲满，等待空位……")
            }
        }
    next:
    }
    time.Sleep(600 * time.Millisecond)
    fmt.Println("完成")
}
```

**要点**：发送 case `case ch <- i:` 在「缓冲未满 / 有接收方在等」时才就绪。上面用 `time.After` 给发送加了个 10ms 的退避重试，避免裸死等。这展示了一个重要思路——**「发送是否成功」也当作事件来 multiplex**，这在 C++ 里只能靠条件变量 + 状态标志手动编。

### 3.10 select 语法速查

| 形态 | 语义 |
|------|------|
| `select {}` | 永久阻塞（无 case） |
| `select { case <-ch: ... }` | 等 ch 有数据 |
| `select { case v := <-ch: ... }` | 等 ch 有数据并取到 v |
| `select { case ch <- x: ... }` | 等 ch 可发送（缓冲未满/有接收方） |
| `select { case v, ok := <-ch: ... }` | 同时得知 ch 是否已关闭 |
| `select { case ...: default: }` | 都不就绪立即执行 default（非阻塞） |
| `for { select { ... } }` | 事件循环 |
| `select { case <-nilCh: ... }` | nil channel 永不就绪 = 禁用该分支 |

---

## 四、常见坑与误区

### 坑 1：已关闭 channel 让 select 空转

**现象**：`select` 循环里某个 case 对应的 channel 被关闭后，程序像「忙等」一样狂刷日志、CPU 飙升。
**原因**：关闭后的 channel 接收 case **永远就绪**，每次 select 都命中它并返回 `(零值, false)`，从不停歇。
**正确写法**：`case v, ok := <-ch:` 里 `!ok` 时显式处理（置 nil 禁用该分支，或 `return` / `break` 退循环）。**信道关闭 ≠ 循环自动结束**，只有 `range` 才会自动退出。

### 坑 2：在一个 goroutine 里同时「收」和「发」同一个 channel

**现象**：死锁 / 逻辑混乱，例如 case 里既 `<-ch` 又 `ch <- x`。
**原因**：收发是配对的，自身等自己的收发必然互相等待（类似自连接）。
**正确写法**：生产者和消费者分离；一个 goroutine 不要在同一 select 里既读又写同一个无缓冲 channel 的匹配端。

### 坑 3：select 分支执行顺序依赖于写码顺序

**现象**：以为 case 从上到下先到先得，结果行为随机。
**原因**：多个就绪 case 时 Go **随机公平**，不按书写顺序。
**正确写法**：需要优先级时，拆成多个 select 按序执行，或用条件把「高优先级」单独先处理。

### 坑 4：只发不收 / 只收不发 → 死锁

**现象**：`select { case ch <- 1: }` 且没有任何 goroutine 准备接收 → 永久阻塞，main 里直接死锁 panic。
**原因**：select 里看似「等 branch」，实际上分支内部仍是收发配对语义。
**正确写法**：给 select 配 `default`（非阻塞）或 `time.After`（超时），不要裸等一个不可能就绪的收发。

### 坑 5：select 超时后，慢 goroutine 成了「孤儿」

**现象**：超时返回了，但背后的 goroutine 还在跑，最终往无接收的 channel 发/收，永远阻塞 → **goroutine 泄漏**。
**原因**：C++ 里线程泄漏要小心，Go 里 goroutine 泄漏同样真实存在——超时 ≠ 取消。
**正确写法**：用 `context`（见 `[[06-context超时取消与传值]]`）做父级取消，慢操作监听 `ctx.Done()` 自行收尾。

### 坑 6：把 `time.After` 写在循环体内

**现象**：`for { select { case <-ch: ...; case <-time.After(1*time.Second): ... } }` 里超时每次循环都重新计时——根本不是「整体超时」。
**原因**：`time.After` 在 select 里是**表达式**，每次循环重新调用，计时器反复重置。
**正确写法**：把时钟提前建好：`timer := time.NewTimer(1*time.Second); for { select { case <-ch: case <-timer.C: ... } }`；或者改用 `ctx.WithTimeout`。

---

## 五、练习任务

- [ ] 写一个「双路赛车」：两个 goroutine 各自延时随机，select 打印先到达的通道名，跑多次观察公平性
- [ ] 用 select + default 写一个非阻塞轮询消费者：有数据就消费，没数据打印"空闲"，跑若干轮
- [ ] 把 C++ 里写过的「多 socket epoll 事件循环」，用 Go 改写成「select 监听 N 个 channel」的版本，比较事件分发的写法差异
- [ ] 用 `time.After` 给一个「永不出结果的 goroutine」加 1 秒超时，观察超时分支触发并说明会有什么副作用
- [ ] 写一个事件循环后台任务：同时监听「数据」「停止」「心跳」三个 channel，收到停止时优雅退出（defer 清理）
- [ ] 构造一个「已关闭 channel 导致 select 空转」的程序，用 `v, ok := <-ch` 和置 nil 的方式修复，对比修复前后的 CPU 表现
- [ ] 修复「time.After 写循环体」问题：把计时提到循环外，验证超时语义变化

---

## 六、延伸与参考

- [The Go Programming Language Spec - Select statements](https://go.dev/ref/spec#Select_statements)（select 权威语法）
- [Go by Example - Select](https://gobyexample.com/select)
- [The Go Blog - Go Concurrency Patterns: Timing out, moving on](https://go.dev/blog/concurrency-timeouts)（超时与移动的经典模式）
- 相关笔记：[[02-channel详解]]、[[06-context超时取消与传值]]、[[07-并发模式-workerpool-扇入扇出-pipeline]]