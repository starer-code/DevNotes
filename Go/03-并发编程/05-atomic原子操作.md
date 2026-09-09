# 05 - atomic 原子操作

> C++ 的 std::atomic<T> 在 Go 里是 sync/atomic 包：无锁计数器、无锁标志位、无锁状态机的最优解

---

## 一、简述

`sync/atomic` 提供对内存地址的**原子操作**：`Add`（原子加）、`Load`（原子读）、`Store`（原子写）、`CompareAndSwap`（比较并交换）、`Swap`（交换）。它们作用于 `int32` / `int64` / `uint32` / `uint64` / `uintptr` / `unsafe.Pointer` 以及 `atomic.Value`。

和 Mutex 相比，原子操作是**免锁（lock-free）**的：既不阻塞、也无上下文切换开销，在「高频计数器、状态标志、一次性初始化标志」这类场景下性能明显优于锁。代价是**只能保护单变量**，且不能声明「一段代码的整齐」。

> **核心要点**：读——`Load`、写——`Store`、改——`Add` / `CompareAndSwap`。把「多步的读-改-写」用一个 CAS 原子完成，是理解 Go 原子操作的钥匙。C++ 里的 `std::atomic<int>` 心智模型几乎原样平移，差异只在 API 命名和哪些类型支持。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 原子整数 | `std::atomic<int> n{0}` | `var n atomic.Int64`（或 `var n int64` + `atomic.AddInt64`） | Go 1.19+ 有类型化 `atomic.Int64`，更顺手 |
| 原子加 | `n.fetch_add(1)` | `atomic.AddInt64(&n, 1)` | Go 返回新值；`AddInt32` / `AddUint64` 等按类型 |
| 原子读 | `n.load()` | `atomic.LoadInt64(&n)` | Go 读不写也有可能被优化异常，必须用 Load |
| 原子写 | `n.store(42)` | `atomic.StoreInt64(&n, 42)` | Go 生硬但显式；`Load`/`Store` 配对使用 |
| 比较并交换 | `n.compare_exchange_strong(expected, desired)` | `atomic.CompareAndSwapInt64(&n, old, new)` | CAS 失败返回 false，循环重试是惯用法 |
| 原子交换 | `n.exchange(42)` | `atomic.SwapInt64(&n, 42)` | 有返回：交换前旧值 |
| 原子布尔/指针 | `std::atomic<bool>` / `std::atomic<T*>` | `atomic.Bool`（1.19+）/ `atomic.Pointer[T]`（1.19+） | Go 类型化版本避免手写 unsafe.Pointer |
| 任意值原子存取 | `std::mutex` 包 struct | `atomic.Value`（存储任意类型） | Value 的 Load 要求「上次存过的类型」 |
| 内存顺序 | `memory_order_relaxed` / `seq_cst` | Go 只有一种宽松模型：默认按需次序 | Go 不暴露 memory_order，编译器+运行时兜底 |

---

## 三、逐主题详解

### 3.1 计数器：`AddInt64` / `AddUint64`

经典场景——无锁计数器，多 goroutine 并发累加。

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var counter int64 // 注意：不是 atomic.Int64 的话，必须用指针传给原子函数

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&counter, 1) // 原子 +1，内部是 LOCK 前缀/xchg，免锁
        }()
    }
    wg.Wait()
    fmt.Println("counter =", atomic.LoadInt64(&counter)) // 1000
    // 若用普通 counter++ 则大概率 < 1000（丢更新）
}
```

**对比 Mutex 版**：原子版没有临界区、没有锁等待，只有一条指令。计数器这种场景**原子操作完胜**。

> ⚠️ **C++ 对照**：等价 `std::atomic<long long> counter; counter.fetch_add(1, std::memory_order_relaxed);`。Go 把 `memory_order` 藏在运行时，你只需要做对「读用 Load、写用 Store」这一件事。

### 3.2 Load / Store：读-写拆分

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var status atomic.Int64 // Go 1.19+ 类型化原子变量，自带方法

    var wg sync.WaitGroup
    // 写者：把状态从 0 切到 1
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 5; i++ {
            status.Store(int64(i)) // 原子写
        }
        status.Store(100)          // 终态
    }()

    // 读者：原子读
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 10; i++ {
            v := status.Load() // 原子读，绝不读到一个被撕裂的中间值
            if v == 100 {
                fmt.Println("读到终态:", v)
                return
            }
        }
    }()
    wg.Wait()
}
```

**要点**：
- `Load` / `Store` 都是记忆屏障（memory barrier）级别的读写：**读者的 Load 不会看到撕裂值**，写者的 Store 在别的 goroutine 的 Load 里立即可见（配合 Go 内存模型的 happen-before）。
- 用**类型化原子**（`atomic.Int64`、`atomic.Bool`、`atomic.Pointer[T]`、`atomic.Value`）比函数式 API 好读、不用取址。

```go
// 函数式 / 类型化两种写法对比
var a int64
atomic.AddInt64(&a, 1)             // 函数式：把 plain int64 交给原子函数

var b atomic.Int64                  // 类型化：字段自带方法，无需取址
b.Add(1)
b.Load()
b.Store(42)
```

### 3.3 CompareAndSwap：无锁状态机的核心

CAS 是「先看是不是我预期的旧值，是才改成新值，全程原子」——这是实现无锁逻辑的地基。

```go
package main

import (
    "fmt"
    "sync/atomic"
)

func main() {
    var state int64 = 0

    // 期望 0，想改成 1
    ok := atomic.CompareAndSwapInt64(&state, 0, 1)
    fmt.Println("第一次 CAS:", ok, "state =", state) // true, 1

    // 期望 0，但当前已是 1 → 失败
    ok = atomic.CompareAndSwapInt64(&state, 0, 2)
    fmt.Println("第二次 CAS:", ok, "state =", state) // false, 1（未被改动）
}
```

**CAS 循环（自旋重试）**：多个 goroutine 抢一个资源时，谁 CAS 成功谁走，失败的重试。

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var ticket int64

    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for {
                old := ticket.Load()
                newVal := old + 1
                if atomic.CompareAndSwapInt64(&ticket, old, newVal) {
                    fmt.Printf("goroutine %d 抢到号 %d\n", id, newVal)
                    return
                }
                // CAS 失败：别人改了，重读再试（自旋）
            }
        }(i)
    }
    wg.Wait()
    fmt.Println("最终 ticket =", ticket.Load()) // 5
}
```

> **C++ 对照**：CAS 循环 ≡ `compare_exchange_strong` 失败后 `fetch_add` / 重试。注意 `compare_exchange_weak` vs `strong` 的区别在 Go 里不存在——Go 只有一种 CAS，失败返回 false。

### 3.4 Swap：原子交换

```go
package main

import (
    "fmt"
    "sync/atomic"
)

func main() {
    // 把指针「偷走」：Swap 经常用来取走一个值并把占位替回去
    var slot atomic.Int64
    slot.Store(7)

    old := slot.Swap(999) // 返回旧值，然后写入 999
    fmt.Println("旧值:", old, "新值:", slot.Load()) // 7, 999
}
```

**应用**：单槽位「取旧填新」、无锁队列的 head/tail 指针腾挪都用到 Swap。和 CAS 的区别：**Swap 无条件替换**，CAS 有条件替换。

### 3.5 `atomic.Bool` 与 `atomic.Pointer[T]`：类型化便捷版本（Go 1.19+）

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

type Config struct{ Version int }

func main() {
    // atomic.Bool：无锁布尔标志
    var shutdown atomic.Bool
    shutdown.Store(false)

    go func() {
        time.Sleep(200 * time.Millisecond)
        shutdown.Store(true)
        fmt.Println("已发出关闭信号（原子写入）")
    }()

    // atomic.Pointer[Config]：无锁读最新配置快照
    var cfg atomic.Pointer[Config]
    cfg.Store(&Config{Version: 1})

    for !shutdown.Load() {
        c := cfg.Load() // 永远读到完整、一致的 Config 指针
        fmt.Printf("版本: %d\n", c.Version)
        time.Sleep(50 * time.Millisecond)
    }
    fmt.Println("服务已停止")
}
```

**经典应用**：**配置热更新**——配置结构体每次整份写入新指针，读者原子 Load 指针，拿到的永远是「某个完整版本」，不需要锁。

### 3.6 `atomic.Value`：任意类型的原子存取（Go 1.19 以前的主力）

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var v atomic.Value
    v.Store(map[string]int{"a": 1}) // 首次 Store 决定类型：map[string]int

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        m := v.Load().(map[string]int) // Load 返回值必须是上次 Store 的类型
        fmt.Println("读者看到:", m["a"])
    }()

    // 再存同类型
    v.Store(map[string]int{"a": 1, "b": 2})
    wg.Wait()

    // v.Store("different") // ❌ panic：Store 类型必须与首次一致
}
```

**规则**：`atomic.Value` 首次 Store 的类型被「冻结」，之后必须存同类；`Load` 返回 `any`，需断言。1.19+ 多数场景可用 `atomic.Pointer[T]` 代替，语义更清晰。

### 3.7 原子 vs 锁怎么选

| 维度 | 原子操作 | Mutex |
|------|---------|-------|
| 保护范围 | 单个变量 | 一段代码 / 多个变量的一致性 |
| 性能 | 极快（一条指令） | 有锁等待、上下文切换开销 |
| 使用难度 | 只解决单变量问题 | 通用但过度使用有死锁风险 |
| 适用场景 | 计数器、标志位、状态机、指针快照 | 复杂临界区、多字段结构体变更 |

> ⚠️ **经验法则**：**单变量 = 原子；多变量一致性 / 复杂操作 = 锁**。用原子去拼「多字段一致」是在重新发明锁，正确性极难保证。

### 3.8 内存顺序：Go 只有一个模型

C++ 里有 `memory_order_relaxed / acquire / release / seq_cst`；Go **不暴露** memory_order，语言规范只保证：
- 一个 goroutine 对变量原子 Store 的值，在**别的 goroutine 对该变量的 Load** 上能如实看到；
- Load/Store 提供**最基本的发生前关系**（happen-before）。

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"
)

var flag atomic.Bool

func main() {
    go func() {
        flag.Store(true)   // 原子写
        fmt.Println("flag = true 已写入")
    }()

    time.Sleep(20 * time.Millisecond)
    fmt.Println("读到 flag =", flag.Load()) // 大概率 true；Load 保证读到某个原子一刻的值
}
```

**理解**：Go 的内存模型比 C++ 的更简单——只要求「原子的 Load 能看到原子的 Store 的写入结果」，没有「非原子变量则完全不管」的自由度差异。实际工程里：**非原子字段的读写也用相同锁或 channel 串行化**，不要幻想原子变量能替别的一般变量做依赖排序。

### 3.9 用 atomic 实现一个自旋锁（对照 C++ 心智）

自旋锁是「原子操作」最经典的教学案例：一个 `atomic.Bool`（或 `atomic.Int64`）做锁状态，获得失败就继续自旋重试。**生产代码优先 `sync.Mutex`**（Go 运行时对 Mutex 有自旋优化 + park），但理解它是理解 CAS 的捷径。

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
)

type SpinLock struct {
    locked atomic.Bool // false = 空闲，true = 已被占用
}

func (s *SpinLock) Lock() {
    // 抢锁：期望 false，改成 true；失败说明别人持锁，继续转圈
    for !s.locked.CompareAndSwap(false, true) {
        runtime.Gosched() // 让出 CPU 时间片，避免单核自旋饿死别的 goroutine
    }
}

func (s *SpinLock) Unlock() {
    s.locked.Store(false) // 释放
}

func main() {
    var (
        spin SpinLock
        wg   sync.WaitGroup
        n    int
    )

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            spin.Lock()
            n++ // 临界区
            spin.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println("自旋锁保护下的 n =", n)

    _ = runtime.Gosched // 保持 import
}
```

> **C++ 对照**：这段代码几乎是 `std::atomic_flag` + while 自旋的直译：
> ```cpp
> std::atomic_flag lock = ATOMIC_FLAG_INIT;
> while (lock.test_and_set()) sched_yield();  // C++ 版抢锁
> lock.clear();                                // C++ 版释放
> ```
> 区别：C++ 的 `test_and_set` 是无条件交换，Go 的 `CompareAndSwap(false, true)` 是「期望值 + 条件交换」，意图更明确，还能避免 ABA 问题的一部分。

---

## 四、常见坑与误区

### 坑 1：`counter++` 直接裸跑，以为快了

**现象**：1000 个 goroutine 对普通 `int64` 做 `counter++`，结果不足 1000（时对时错）。
**原因**：`++` 是读-改-写三步，多 goroutine 交错会丢更新（C++ 里同样）。
**正确写法**：`atomic.AddInt64(&counter, 1)`；读结果用 `atomic.LoadInt64`（别直接读 `counter`）。

### 坑 2：用 `atomic.Load` 读「非原子的 Go 变量值」

**现象**：`x := atomic.LoadInt64(&c)` 读到的是一致值，但旁边直接 `c` 的普通读取可能是撕裂的。
**原因**：Load/Store 只对**传参的变量**提供原子性；普通读取没有屏障。
**正确写法**：要原子就**统一走原子 API**——读也用 `Load`、写也用 `Store`、改也用 `Add`/`CAS`，别混着来。

### 坑 3：CAS 循环里忘记重新 Load

**现象**：自旋 CAS 用「缓存的旧值」无限失败，或误判失败。
**原因**：CAS 的期望值必须和当前值一致才成功；别人改过之后你的旧期望永远失败。
**正确写法**：每次重试都重新 `Load` 最新值再 CAS；或改用 `Add` 等更简单的语义。

### 坑 4：`atomic.Value` 存不同类型 panic

**现象**：`panic: sync/atomic: store of inconsistently typed value into Value`。
**原因**：`Value` 首次 Store 类型被冻结，二次 Store 不同 `type` 直接 panic。
**正确写法**：确认每次都存同一个 struct 类型；或改用 `atomic.Pointer[T]` 让编译器替你管类型。

### 坑 5：以为原子变量能替代锁去保护多个变量

**现象**：两个变量 A、B 分别原子写，读者分别原子读，但「A 和 B 的组合状态」读到的是新旧混杂。
**原因**：原子性只有「单变量」粒度，跨变量的一致性需要锁或整体封装（指针快照）。
**正确写法**：把 A、B 打包成一个 struct，用 `atomic.Pointer[Snapshot]` 整份替换。

### 坑 6：用 `atomic.Bool` 做「指令重排屏障」，幻想它约束别的变量

**现象**：`atomic.Bool` 写 true 后立刻写普通变量，读者读 Bool 后再读普通变量，有时读到旧值。
**原因**：Go 原子不提供 C++ 的 acquire/release 语义给你自由组合；依赖非原子字段的顺序是不可靠的。
**正确写法**：字段间顺序用 channel / Mutex / 同一把锁保证；原子只信任「单变量的值」本身。

### 坑 7：性能对比误区——「原子比锁快，就全换原子」

**现象**：把多字段对象整段改成原子操作，正确性痛苦、性能也没赢。
**原因**：原子 vs 锁的差距在「高竞争下锁等待」才明显；低竞争时 Mutex 也就多一个 fast-path 判断。
**正确写法**：小字段（计数器/标志）用原子；对象 / 集合 / 多字段一律用锁；先 `go test -bench` 再优化。

---

## 五、练习任务

- [ ] 用 `atomic.AddInt64` 写一个无锁计数器，开 1000 个 goroutine，验证结果恰好 1000；再用裸 `++` 对比，观察丢更新
- [ ] 用 `atomic.Bool` 实现优雅退出：后台任务每 50ms 检查一次，主 goroutine 若干毫秒后置 true，打印退出
- [ ] 把 C++ 里用 `std::atomic<int>` 写过的「无锁计数器 / 自旋锁」，改写成 Go 版（`sync/atomic` + CAS），比较 API 差异
- [ ] 用 `atomic.Pointer[Config]` 实现配置热更新：写者整份替换配置快照，多个读者并发 Load，确认读到的永远一致
- [ ] 用 CAS 循环实现「发放不重复的递增序号」：5 个 goroutine 各领 20 个号，确认 1~100 无重复、无遗漏
- [ ] 故意把 `atomic.Value` 存两种不同类型，运行观察 panic，说明触发条件
- [ ] （进阶）写一个基于 CAS + 切片实现的并发友好计数器（如 ticket 分发），跑 `go run -race` 验证无数据竞争

---

## 六、延伸与参考

- [sync/atomic 官方文档](https://pkg.go.dev/sync/atomic)
- [Go by Example - Atomic Counters](https://gobyexample.com/atomic-counters)
- [The Go Memory Model](https://go.dev/ref/mem)（原子操作在 happens-before 中的位置）
- 相关笔记：[[04-sync包-WaitGroup-Mutex-Once]]、[[07-并发模式-workerpool-扇入扇出-pipeline]]、[[08-数据竞争与race检测]]