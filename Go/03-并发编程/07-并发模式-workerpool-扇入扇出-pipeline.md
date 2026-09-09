# 07 - 并发模式（worker pool / 扇入扇出 / pipeline）

> C++ 里要自己造轮子的线程池、任务队列、流水线，Go 用 channel 组合出几种固定范式，一次学会受用终生

---

## 一、简述

「并发模式」不是语法，而是被反复验证有效的**编排范式**。Go 里它们几乎全由 channel + goroutine 组合而成：worker pool（工人池）、fan-out（扇出）、fan-in（扇入 / 汇聚）、pipeline（流水线）、限速器（rate limit）、错误传播。

对于 C++ 开发者，这些模式你多半见过、也手动实现过：

| 模式 | C++ 里怎么做的 | 痛点 |
|------|---------------|------|
| 线程池 | `std::thread` 数组 + `std::queue` 任务 + mutex 守卫 | 线程生命周期、任务派发、锁竞争都要自己管 |
| 扇出 | 把一个大任务拆 N 份发给 N 线程 | 怎么「等所有分片」+ 汇总 |
| 流水线 | 每个 stage 一个线程 + 队列 + condvar | 队列水果园 / 关停时机难管 |
| 限速 | 令牌桶 / 手写信号量 | 又要造一个计数器 + 条件变量 |

Go 里这些平均不到 30 行，且**语义全部显式可见**。本笔记不讲抽象，直接给 6 个能 `go run` 的模板。

> **核心要点**：所有模式都建立在「**channel 即队列 + 同步**」之上。模式 = 固定形状的 channel 拓扑 + 一股约定（谁 close、谁 range、谁 Wait）。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 任务队列 | `std::deque<Task>` + mutex + condvar | `加工：ch := make(chan Task, N)` | channel 自带锁 + 阻塞 + 容量 |
| 工人 | 线程数组 `vector<std::thread>` | goroutine + `for range jobs` | goroutine 轻量，池大小自定 |
| 派发任务 | 入队 → `cv.notify_one()` | `jobs <- task` | 缓冲满时自然背压 |
| 收结果 | 每个 worker 推共享 vector + 锁 | `results := make(chan Result, N)` | fan-in 就是多个 goroutine 共写一个 channel |
| 等待全部工人 | `join()` 每个线程 | `wg.Wait()` / 收满 N 个结果 | WaitGroup 一次搞定 |
| 流水线 stage | 每个 stage 一个线程 + 队列 | `out := stage(in)` 函数串联 | **每个 stage 是纯函数式变换** |
| 限速 | 信号量 `sem_wait/sem_post` | `ticker := time.NewTicker(...); <-ticker.C` | 用「滴答 channel」做令牌 |
| 错误汇聚 | 手写异常收集 | `select` / `errgroup` | Go 有现成范式 |

---

## 三、逐主题详解

### 3.1 Worker Pool（工人池）通用模板

固定 N 个工人，从任务 channel 取活干，结果汇到结果 channel。

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func worker(id int, jobs <-chan int, results chan<- int, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs { // range 自动感知 jobs 关闭
        time.Sleep(50 * time.Millisecond) // 模拟干活
        results <- j * 2
        fmt.Printf("工人 %d 处理了任务 %d\n", id, j)
    }
}

func main() {
    const numJobs, numWorkers = 10, 3
    jobs := make(chan int, numJobs)
    results := make(chan int, numJobs)

    var wg sync.WaitGroup
    // 启动固定数量的工人
    for i := 1; i <= numWorkers; i++ {
        wg.Add(1)
        go worker(i, jobs, results, &wg)
    }

    // 主 goroutine 派发任务（提前派完）
    for j := 1; j <= numJobs; j++ {
        jobs <- j
    }
    close(jobs) // 任务派发完，关掉任务队列 → workers 的 range 结束

    wg.Wait()   // 全部工人收工
    close(results) // 结果也关，方便 range 收集

    for r := range results {
        fmt.Println("结果:", r)
    }
}
```

**模板要点**：
- `jobs` 用 `close` 表示「没有更多任务了」；`range` 消费是工人侧的标准写法。
- 缓冲容量 = 任务量，派发不阻塞；量大时用容量小一点的缓冲，靠 channel 自身做**背压（backpressure）**。
- `results` 缓冲大小 = numJobs，保证工人写结果也不阻塞；收完 `close` 再 range。

> **C++ 对照**：这就是你会在生产 C++ 里手搓的线程池，但 Go 里**没有一个 `delete worker` / 线程析构 / 锁细节**——工人结束的条件就是「jobs 关了 + 队列清空」。

### 3.2 Fan-out（扇出）：一个生成器 → 多条消费线

把「一个上游」的任务分给「多个下游」去处理，天然地扩展吞吐。

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    jobs := make(chan int, 10)

    // 扇出：两个消费组同时消费同一 jobs channel
    var wg sync.WaitGroup
    consume := func(name string) {
        defer wg.Done()
        for j := range jobs {
            fmt.Printf("%s 处理 %d\n", name, j)
            time.Sleep(30 * time.Millisecond)
        }
    }

    wg.Add(2)
    go consume("消费者A")
    go consume("消费者B")

    // 生产者喷出任务
    for i := 1; i <= 8; i++ {
        jobs <- i
    }
    close(jobs)

    wg.Wait()
    fmt.Println("扇出完成：8 个任务被 2 个消费者分掉了")
}
```

**注意**：多个消费者共享一个 channel，channel 保证每个任务**恰好被一个消费者取走**——你不用管锁，channel 自己保证「一条消息一个消费者」。

> ⚠️ **C++ 对照**：C++ 里 N 个线程从共享队列取任务，必须 mutex 包住 pop；Go 的 `<-jobs` 天然互斥，且公平分发由运行时保证。

### 3.3 Fan-in（扇入）：多条生产线的结果汇到一条

多个 goroutine 各产出一部分结果，都写同一个结果 channel，需求方统一收。

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func producer(name string, count int, out chan<- string, wg *sync.WaitGroup) {
    defer wg.Done()
    for i := 1; i <= count; i++ {
        out <- fmt.Sprintf("%s-%d", name, i)
        time.Sleep(20 * time.Millisecond)
    }
}

func main() {
    results := make(chan string, 12)

    // 三个生产者都往同一个 results 里塞（扇入）
    var wg sync.WaitGroup
    wg.Add(3)
    go producer("苹果", 4, results, &wg)
    go producer("香蕉", 4, results, &wg)
    go producer("梨子", 4, results, &wg)

    // 关掉 producers 后统一关 results
    go func() {
        wg.Wait()
        close(results) // 全部生产者收工 → 消费方 range 才能结束
    }()

    // 需求方一条线收齐所有结果
    for r := range results {
        fmt.Println("收到:", r)
    }
    fmt.Println("扇入收敛完成")
}
```

**关键套路**：扇入的 close 由一个**独立的 goroutine** 来做——`wg.Wait()` 保证所有生产者都结束，然后才 close results，消费方的 `range` 才能正常结束。**不要把 close 放在主流程上抢跑**，否则会「提前关 channel 导致生产者 panic：send on closed channel」。

### 3.4 Pipeline（流水线）：stage 函数式串联

每个 stage 是「输入 channel → 处理 → 输出 channel」的纯函数，串联成流水线。

```go
package main

import (
    "fmt"
)

// stage 1: 生成数字
func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        for _, n := range nums {
            out <- n
        }
        close(out)
    }()
    return out
}

// stage 2: 乘 2
func multiply(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for n := range in {
            out <- n * 2
        }
        close(out)
    }()
    return out
}

// stage 3: 加 1
func addOne(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for n := range in {
            out <- n + 1
        }
        close(out)
    }()
    return out
}

func main() {
    // 流水线组装：gen → multiply → addOne
    pipeline := addOne(multiply(gen(1, 2, 3, 4)))

    for v := range pipeline {
        fmt.Println("流水线输出:", v) // (n*2+1): 3, 5, 7, 9
    }
}
```

**Go Concurrency Patterns 官方范式**：每个 stage 就是一个「做一个 of filter / 变换的函数」，串起来就是一个数据流。**无锁、无状态、每级只依赖上一级输出**——这就是 Go 流水线的精髓。

**带 WaitGroup 的完整 pipeline（多个并发 stage）**：

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    in := make(chan int, 10)
    out := make(chan string, 10)

    // 两个并行的「处理 stage」都写 out（扇入式的流水线宽度=2）
    var wg sync.WaitGroup
    for w := 1; w <= 2; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for n := range in {
                out <- fmt.Sprintf("stage%d: %d*10=%d", id, n, n*10)
            }
        }(w)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    for i := 1; i <= 5; i++ {
        in <- i
    }
    close(in)

    for r := range out {
        fmt.Println(r)
    }
}
```

### 3.5 限速器（Rate Limit）：用 ticker 做令牌

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    // 令牌滴答：每 200ms 放行一次
    limiter := time.NewTicker(200 * time.Millisecond)
    defer limiter.Stop()

    requests := []int{1, 2, 3, 4, 5}
    for _, r := range requests {
        <-limiter.C // 令牌不到，这里就阻塞 → 天然限速
        fmt.Println("放行请求:", r, "at", time.Now().Format("15:04:05.000"))
    }

    // 带 burst 的限速：预填 3 个令牌，之后按 200ms 补一个
    bursty := make(chan struct{}, 3)
    for i := 0; i < 3; i++ {
        bursty <- struct{}{} // 预填（burst）
    }
    go func() {
        tick := time.NewTicker(200 * time.Millisecond)
        defer tick.Stop()
        for t := range tick.C {
            _ = t
            bursty <- struct{}{} // 低频补令牌
        }
    }()

    for i := 1; i <= 5; i++ {
        <-bursty // 前 3 个立刻放行（有 burst），后 2 个要等补令牌
        fmt.Println("突发请求", i, "放行")
    }
}
```

> **C++ 对照**：令牌桶在 C++ 里要自己写「以时间补令牌 + 原子递减」；Go 的 `Ticker` channel 把「时间到点」做成事件，限速器就是「等事件」这么简单。

### 3.6 错误传播：`select` 汇聚错误 / errgroup

流水线里某个 stage 出错，怎么通知整个链？两种常见方案：

**方案 A：结果带 error 的结构体**

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

type Result struct {
    Value int
    Err   error
}

func worker(in <-chan int, out chan<- Result) {
    for n := range in {
        if n == 3 { // 模拟「这个任务会失败」
            out <- Result{Err: errors.New("task 3 数据非法")}
            continue
        }
        out <- Result{Value: n * 2}
    }
}

func main() {
    tasks := make(chan int, 5)
    results := make(chan Result, 5)

    go worker(tasks, results)

    for i := 1; i <= 5; i++ {
        tasks <- i
    }
    close(tasks)

    for i := 0; i < 5; i++ {
        r := <-results
        if r.Err != nil {
            fmt.Println("发现错误:", r.Err)
            continue
        }
        fmt.Println("结果:", r.Value)
    }
    _ = time.Second
}
```

**方案 B：errgroup 自动 propagate（配合 context）**

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    var g errgroup.Group

    for i := 1; i <= 4; i++ {
        i := i
        g.Go(func() error { // g.Go 就驱动一个 goroutine
            select {
            case <-time.After(time.Duration(i) * 100 * time.Millisecond):
                if i == 2 {
                    return errors.New("stage 2 失败")
                }
                return nil
            case <-ctx.Done():
                return ctx.Err() // 别的任务失败 → 取消信号 → 快速退出
            }
        })
    }

    if err := g.Wait(); err != nil {
        fmt.Println("errgroup 捕获第一个错误:", err)
    }
}
```

> **C++ 对照**：错误传播在 C++ 线程里是「收集一遍异常」的脏活；Go 用「错误值作为数据走 channel」或 `errgroup`（内部可接 ctx 播取消）就把「失败即停整条流水线」变成了标准姿势。

---

## 四、常见坑与误区

### 坑 1：没人 close 任务 channel → 工人永远等

**现象**：`jobs` 没关，工人 `for range jobs` 永不退出，`wg.Wait()` 卡死。
**原因**：`range` 靠「关闭」感知结束；`close` 是流水线的「EOF」。
**正确写法**：派完任务立刻 `close(jobs)`；用 `defer` 或在唯一派发点执行。

### 坑 2：提前 close 结果 channel，还会继续写

**现象**：`wg.Wait(); close(results)` 直接写在主流程，但工人还可能在往 results 写 → `panic: send on closed channel`。
**原因**：close 的时机必须在「所有写者都结束后」。
**正确写法**：把「等全部写者 + close」放到**独立的 goroutine**（`go func(){ wg.Wait(); close(results) }()`），消费方在主 goroutine `range`。

### 坑 3：扇出时忘了 channel 保证「一个任务只被消费一次」

**现象**：担心多个消费者抢同一任务，给每个消费者各自开 channel——复杂化了。
**原因**：没吃透 channel 语义。
**正确写法**：多消费者**共用同一个 channel** 即可；channel 保证互斥分发，无需额外锁（这在 C++ 是共享队列 + mutex 的活）。

### 坑 4：流水线 stage 之间用无缓冲 channel，吞吐崩塌

**现象**：stage 一个阻塞连累整条线，吞吐极低。
**原因**：无缓冲 channel 每个值都得「握手」，速度受制于最慢 stage。
**正确写法**：stage 间用**有缓冲 channel**（容量≈平均工作量），做解耦；或用 goroutine 池提高 stage 并行度。

### 坑 5：worker 里再 spawn 子任务，忘记管生命周期

**现象**：worker 内部又 `go func(){...}` 但没纳入 wg，外层 `wg.Wait()` 了还在悄悄跑。
**原因**：WaitGroup 只认 Add 过的计数；子 goroutine 逃逸了。
**正确写法**：所有需等完的子任务都 `Add` 计数；不想等的重活请用 `ctx` 取消（`[[06-context超时取消与传值]]`）。

### 坑 6：限速器 ticker 忘了 Stop

**现象**：长跑程序里 `time.NewTicker` 不 `Stop`，底层定时器泄漏（go vet 也会提示）。
**原因**：Ticker 是活跃对象，不释放一直占资源。
**正确写法**：`defer ticker.Stop()`；`time.After` 则是一次性的、用完自动 GC。

### 坑 7：错把 channel 缓冲当「异步完成任务」

**现象**：`make(chan int, 100000)` 后发完就 return，以为任务排完了——其实任务可能没人处理，进程退出时静默丢弃。
**原因**：缓冲不等于执行。
**正确写法**：区分「缓冲 = 背压上限」与「谁真正在消费」；用 wg / 结果回收 / ctx 收尾确认任务真正被处理完。

---

## 五、练习任务

- [ ] 实现一个通用 worker pool：10 个任务、3 个工人，每个任务打印「由谁处理」，确认每个任务恰好被处理一次
- [ ] 扇出 + 扇入合体：生产 100 个数 → 4 个消费 goroutine 各算平方 → 单 channel 汇聚，校验总和的正确性
- [ ] 把 C++ 里写的「固定线程数线程池（task queue + workers）」改写成 Go 版 worker pool 模板，比较两份代码的锁与队列复杂度
- [ ] 实现三级 pipeline：`gen → filter(只留偶数) → square`，每级是独立函数，验证输出
- [ ] 用 Ticker + burst 实现「每 100ms 一个请求、突发最多 3 个」的限速器，打 10 个请求观察放行节奏
- [ ] 复现坑 2：把 close(results) 放在主流程，观察 send on closed channel panic，再改成独立 goroutine 收尾
- [ ] （进阶）用 errgroup + context 实现「并行抓取 5 个 URL，失败一个就取消整体」，打印首个错误

---

## 六、延伸与参考

- [The Go Blog - Pipelines and cancellation](https://go.dev/blog/pipelines)（官方流水线 + 取消教程，必读）
- [The Go Blog - Advanced Go Concurrency Patterns](https://go.dev/blog/io2013-talk-concurrency)（Rob Pike 讲并发模式）
- [The Go Blog - Go Concurrency Patterns](https://go.dev/talks/2012/concurrency.slide)（worker pool 灵感来源）
- 相关笔记：[[02-channel详解]]、[[03-select多路复用]]、[[04-sync包-WaitGroup-Mutex-Once]]、[[06-context超时取消与传值]]