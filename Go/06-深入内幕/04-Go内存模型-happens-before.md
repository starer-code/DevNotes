# 04 - Go 内存模型：happens-before

> C++ 有 `std::atomic` + 内存序（memory_order），Go 有更少的口子但边界更清楚——channel / Mutex / Once / atomic 各自建立 happens-before

---

## 一、简述

"变量加了锁就不会有竞态"这种直觉在并发世界里是危险的。真正需要回答的问题是：**goroutine A 写了一个值，goroutine B 什么时候能确定读到它？** Go 用一份官方文档——**The Go Memory Model**——精确规定了这些"什么时候"。它定义了 **happens-before** 关系：同步原语（channel、Mutex、WaitGroup、Once、atomic）在**收发/加解锁/等待/原子操作**之间建立序，从而保证内存可见性。理解它，你才知道为什么"不加同步 flag 读 bool"可能读到旧值，也才知道怎么写出不靠运气的并发程序。

> **核心要点**：**happens-before（HB）是"一个事件必须在另一个事件之前发生且其结果可见"的形式化保证**。Go 的并发正确性全部建立在"你用了某个同步原语，它就给你对应的一条 HB 边"上。不用原语 = 没有边 = 编译器/硬件随便重排。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 内存模型文档 | `[memory_order]` 标准章节 | The Go Memory Model（官方文档） | C++ 需要你精确选序，Go 只有"同步原语给全序" |
| 互斥锁 | `std::mutex` 加锁/解锁 | `sync.Mutex` Lock/Unlock | C++ 还要额外配 `atomic` 才能安全读共享变量；Go 锁内一切可见 |
| **放松内存序** | `memory_order_relaxed` | **没有此概念（日常可用）** | Go 只有两档：同步原语→全序，或非同步→无保证 |
| 原子操作 | `std::atomic<T>`（load/store/fetch等） | `sync/atomic` | Go 1.19 之前 atomic 只防撕裂不建 HB；1.19+ 视作同步点 |
| 初始化一次 | `std::once_flag` | `sync.Once` | `once.Do` 完成后，所有 `Do` 返回点看到其写入 |
| 线程等待 | `std::thread::join` | `sync.WaitGroup.Wait` | `Wait` 返回后看到各 `Done` 的写入 |
| 通信同步 | `mutex`+`cv` 手写 | channel | 收发建立 HB，官方推荐优先 channel |
| 主动读屏障 | `atomic_thread_fence` | 无直接对应 | Go 用 `atomic.Load`/互斥代替 fence |
| 悬而未决的"下次可见" | 无 | "稍后某个时刻可见"是合法但**无保证** | 这是最常见的 bug 来源 |
| 数据竞争检测 | TSan（第三方） | `go test -race` 内建 | 干干净净的"竞态即报" |

---

## 三、逐主题详解

### 3.1 你已经在 C++ 里见过的"序"

C++ 的 `memory_order` 有三种强度：`relaxed`（无序）、`acquire/release`（只保证可见但不能越过）、`seq_cst`（全局一致）。Go 的模型把选择收敛成一条规则：

> **Go 的内存模型只承诺两种状态：要么你用了官方同步原语，拿到了相应 HB 边；要么你没用，就"什么也不保证"**。

```
┌─────────────────────────────────────────────────────────┐
│         Go 的"两档"内存模型                             │
│                                                         │
│  档位1：用了同步原语（Mutex/channel/Once/WaitGroup/     │
│           atomic 的某些操作）                           │
│     → 获得精确的 happens-before 边，读写双向可见        │
│                                                         │
│  档位2：普通变量直接读写（无原语）                     │
│     → 编译器可能重排、CPU 可能乱序、缓存可能未同步      │
│        可能在别的 goroutine 读到旧值（甚至永不更新）    │
└─────────────────────────────────────────────────────────┘
```

> **C++ 对照**：如果你 C++ 里用 `std::atomic<int>` 但选了 `memory_order_relaxed`，那么"我看到你写的值"不保证——Go 里"不用原语"就是这个语义的最坏形态。

### 3.2 happens-before 定义（背下来）

**happens-before（HB）** 是一个偏序关系，核心两条：

1. **同一 goroutine 内**：程序顺序（program order）即 HB——上一条语句 happens-before 下一条。
2. **跨 goroutine**：只有通过同步原语建立：如果原语 P 的两个操作有**同步关系（synchronized-before）**，则 P 之前的写 **happens-before** P 之后的读。

它们之间的传递性：如果 `A → B → C` 且 `B` 建立了 HB，则 `A` 的写对 `C` 的读可见。

**推导例子**：

```go
var x int        // 普通变量
var ch = make(chan int)

// goroutine A
func a() {
	x = 1          // 写 x
	ch <- 42       // 发送（同步点）
}

// goroutine B
func b() {
	<-ch           // 接收（同步点）
	fmt.Println(x) // 读 x → 保证为 1！
}
```

- 无缓冲 channel 的**发送完成 happens-before 另一个 goroutine 对同一 channel 的接收完成**（发送→接收）。
- 所以 A 在发送前写的 `x=1`，B 在接收后读一定是 1。**这就是正确的"用通信共享内存"**。

```
  A:        x=1 ──→ ch<-42
                       │ HB
                       ▼
  B:            <-ch ──→ println(x)  必读 1
```

### 3.3 各原语建立的序（必背表）

| 原语 | 操作对 | 建立的 HB | 注释 |
|------|--------|-----------|------|
| 无缓冲 channel | **发送 → 接收** | 发送前写 → 接收后读 | 收发都必须"碰头"，天然同步 |
| 有缓冲 channel | **发送 → 接收** | 发送前写 → 接收后读 | 且容量为 C 时：第 k 个发 → 第 k+C 个发（环上绕一圈） |
| `sync.Mutex` | **解锁(m) → 加锁(m)** | 临界区写 → 拿到锁后读 | 锁的"释放-获取"语义 |
| `sync.RWMutex` | **写锁解锁 → 加读锁** | 同上 | 读锁可重入但性质一致 |
| `sync.WaitGroup` | **Add → Done；多次 Done → Wait 返回** | 所有 Done 前写 → `Wait` 后读 | 不要并发 Add/Done |
| `sync.Once` | **`Do(f)` 返回 → 后续 `Do` 返回** | f 内写 → 之后任何 `do` 后的读 | 只执行一次，所有调用方可见 |
| `atomic`（Go 1.19+） | **同变量 LR/SC** | 写入 → 后续同一变量的读 | 1.19 前的 `atomic` 只保证不撕裂 |
| `runtime.KeepAlive(x)` | 与编译器优化相关 | 防止 x 被"提前回收" | 它建的不是 HB，是"存活"保证 |

### 3.4 不加同步的 bool：为什么读到的可能是旧值

```go
package main

import (
	"fmt"
	"sync"
)

var (
	ready bool
	wg    sync.WaitGroup
)

func main() {
	wg.Add(2)
	go reader()
	go writer()
	wg.Wait()
}

func writer() {
	ready = true // 只写普通 bool，没有任何同步
	wg.Done()
}

func reader() {
	for !ready { // 无原语，编译器/硬件完全可以一直看到 false
		// 死循环可能性真实存在：编译器可能把 !ready 提升为常量
	}
	wg.Done()
	fmt.Println("读到 true")
}
```

- **现象**：这个程序可能卡死，也可能"碰巧"跑通。
- **原因**几层叠加：
  1. **编译器重排**：`reader` 里 `for !ready` 的循环体为空，编译器可能**把 `ready` 的读取提升到循环外**（hoisting），于是读一次旧值 false，永远死循环；
  2. **CPU/缓存**：即使发出读指令，也可能读到自己核心缓存里的旧值；
  3. **无同步点**：没有 Mutex/channel/atomic，Go 模型明确"不保证可见"。

```go
// ✅ 正确写法之一：用 channel 通知
var done = make(chan struct{})

func writer2() {
	ready = true
	close(done) // close 也建立 HB：close 前的写，对「收到关闭」后的读可见
}

func reader2() {
	<-done
	fmt.Println(ready) // 保证为 true
}
```

> ⚠️ 这是 Go 面试/线上事故最经典的一题：**"我明明在另一个 goroutine 赋值了，怎么主程序还读到旧的？"**——不是 Go 傻，是它严格遵承诺：你没用同步原语，它就不承诺可见性。

### 3.5 channel：官方推荐的同步手段

发/收是 Go 中最清晰的 HB 边，而且是**双向的**：

```go
// 传值 + 同步一体
func compute() int {
	// 昂贵计算
	return 42
}

func main() {
	ch := make(chan int)
	go func() {
		v := compute() // 任何写（包括外部变量）
		ch <- v        // 发送：以下所有对 ch 的接收都看到它的前写
	}()
	result := <-ch // 接收：HB 建立
	_ = result
}
```

注意 **关闭 channel 也有语义**：对 channel 的关闭 happens-before 从该 channel 收到"零值/结束"（即 `range` 退出）。因此 `close(done)` 是所有"通知式并发"的可靠背板。

```go
// 用 close 广播：多个 reader 同时被解除阻塞
done := make(chan struct{})
for i := 0; i < 10; i++ {
	go func(n int) {
		<-done // 全阻塞
		fmt.Println("释放", n)
	}(i)
}
close(done) // 广播解除
```

> **C++ 对照**：这最像 `condition_variable` + `notify_all`，但 Go 不收锁、不需要 predicate 自旋，`close` 后每个 receiver 恰好拿到一次 HB。代价是不能重复"notify"（channel 关闭是单向门）。

### 3.6 有缓冲 channel 的"环形语义"：容量 C 的妙处

有缓冲 channel 有一条额外的边界规则，常用于"限流 + 保证先写先看"：

```
容量为 C 的 buffered channel 中：
  第 i 次发送 happens-before 第 i+C 次发送（绕一圈回到起点）
```

实际意义是：**缓冲区的记录是依次可见的**——生产者连续写多个值，消费者不仅收到的时序对，连"生产者当时的外部副作用"（其它变量）也会有正确的 HB。

但注意：**有缓冲 channel 的发送不保证接收者马上读到**（没碰头），只有"容量满后再发"才有同步效果。所以：

```go
// 用有缓冲 channel 做"一次性信号"是反模式（可能收到旧值）
ch := make(chan struct{}, 1)
ch <- struct{}{} // 发送没有 receiver，不等 HB
```

> ⚠️ 想用 channel 同步（HB）+ 不阻塞生产端，正确做法是：**有缓冲 channel + 消费端**（生产者发完就读回），而不是"发一下就完事"。

### 3.7 Mutex 与 RWMutex：锁内一切皆可见

`sync.Mutex` 的 Lock/Unlock 语义与 C++ `std::mutex` 完全一致，是**释放-获取（release-acquire）**：

```
  goroutine A:                     goroutine B:
    x = 1                            m.Lock()
    m.Unlock()  ── 解锁 ──────→      fmt.Println(x)  // 保证 1
```

关键在于：**B 拿到锁的时刻，A 解锁前的所有写都可见**（包括 A 在持有锁期间没写的、但程序上更早的写）。这比"只保护 x"宽得多——**锁是内存栅栏**，不是"只护住临界区那个变量"。

- `sync.RWMutex`：写锁解锁 → 加读锁，同样 HB。写锁与读锁互斥，读锁之间可并发。
- 常见错误：**读的时候不加锁**（以为"读不会破坏数据"），其实读不加锁就**没有 HB 边**，读到的是旧数据/撕裂值，`-race` 也会报警。

### 3.8 `sync.Once`：只执行一次的构造

```go
var (
	cfg   *Config
	once  sync.Once
)

func getConfig() *Config {
	once.Do(func() {
		cfg = loadConfig() // 大量写入
	})
	return cfg // 任何后续调用者都看到 once.Do(f) 的写入
}
```

`sync.Once` 的语义：**第一次 `Do(f)` 的返回 happens-before 所有后续 `Do(...)` 的返回**。所以"懒加载单例"在 Go 里安全且轻（无锁读）。C++ 对应 `std::call_once`（`std::once_flag`）——但 C++ 里 `call_once` 后想安全读还要确保你的读在 `call_once` 之前完成且有 acquire 序；Go 的 `Do` 天然把"执行"与"可见"绑定。

### 3.9 `sync/atomic`：从"防撕裂"到"同步点"

- Go 1.19 之前：`atomic.LoadInt32` 等**只保证不撕裂**（一个字内原子），并不自动建立与其它写的 HB（当时要配合手动逻辑/锁）。
- Go 1.19 之后：`sync/atomic` 的定义更新，明确"符合 Go 内存模型中对同步原语的要求"，即**对同一地址的 store 与后续 load 建立 HB**。同时 `atomic.Int32` 等类型化 API 成为推荐（官方安全 API 类型）。

```go
import "sync/atomic"

var flag atomic.Bool

go func() {
	// 做一堆准备工作
	flag.Store(true)   // 此后 flag.Load() == true 的观察者
}()

if flag.Load() {      // 读到 true 时，因 HB，初始化写都可见
	useCache()
}
```

> ⚠️ 但注意：**只用 atomic 读取/写入普通变量的"其它字段"仍无保证**。atomic 只把"同一地址"的访问串起来；如果你要用标志位去发布一个 `*Config` 指针，应该配合"先把指针写到一个 `atomic.Pointer`，再 Load 出来"（这才能发布完整结构）。

### 3.10 一个完整的合成例子：发布一个结构体

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type Config struct {
	Addr string
	Port int
}

var (
	cfgPtr atomic.Pointer[Config] // 发布指针的原子槽
	wg     sync.WaitGroup
)

func publish() {
	defer wg.Done()
	cfg := &Config{Addr: "10.0.0.1", Port: 8080}
	cfgPtr.Store(cfg) // 发布：之后 Load 到该指针的人，必然看到 cfg 全部字段
}

func read() {
	defer wg.Done()
	for {
		if cfg := cfgPtr.Load(); cfg != nil {
			fmt.Println(cfg.Addr, cfg.Port) // 永远打印 10.0.0.1 8080
			return
		}
	}
}

func main() {
	wg.Add(2)
	go publish()
	go read()
	wg.Wait()
}
```

这里的原理：`atomic.Pointer` 的 Store 是一个同步点，Load 命中后，**指针所指对象的字段是"通过指针代入"的**，因此不会出现"看到指针但字段是零值"的撕裂状态。这正是 "用 `atomic` 发布指针代替加锁" 的安全版模式（C++ 对应 `std::atomic<std::shared_ptr>` 或 `seq_cst` 的 `atomic<T*>` + 结构体发布）。

### 3.11 数据竞争检测：`-race` 是全套模型的实证

Go 的 `go test -race`（或 `-buildmode=... -race`）内置 **TSan**，它利用内存模型的所有规则对运行期程序做竞争检测：

```bash
go test -race ./...          # 单测带竞争检测
go run -race main.go         # 直接跑也带
go build -race -o bin main.go
```

- **理论承诺**：`-race` 报告的是"无任何 HB 边却共享可变状态"的访问对——这正是内存模型禁止的。
- **实践价值**：CI 里必开。C++ 里要用 ThreadSanitizer 三方的 `-fsanitize=thread`，Go 一手内置。
- **遗漏风险**：race 是**动态**检测，只在"恰好发生交错"的路径上报；没发生不等于没竞态，仍要靠设计保证。

---

## 四、常见坑与误区

### 坑 1：普通变量看看你写的"后来赋值"就会更新

**现象**：goroutine A `for{}` 里设 `done=true`，goroutine B `for !done {}` 死等，可能永远等不到。
**原因**：无同步点 = 无 HB 边；编译期提升（hoisting）+ CPU 缓存使旧值持久可见。
**正确写法**：用 `close(done)`、channel 收发、Mutex、或 `atomic.Bool` 的 Store/Load。**任何跨 goroutine 的变量必须经原语传达。**

### 坑 2：从 C++ 带来"volatile 代替锁"的习惯

**现象**：Go 里想找 `volatile`；写 `var done bool` 加 `for !done {}` 自旋 + `runtime.Gosched()`，以为能"防编译器优化"。
**原因**：Go 没有 `volatile`（`unsafe` 里没有对应物）。`Gosched` 让出土里的 CPU 给别的 G，但**不建立 HB**。
**正确写法**：统一用 `sync/atomic`（`done.Load()` / `done.Store(true)`）+ 类型化 API；要"volatile 直觉"就翻译成 `atomic.Load/Store`。

### 坑 3：只在加锁时写、读时"不加锁没关系"

**现象**：写加 Mutex，读走裸变量："读不会写坏数据"。`-race` 却报警。
**原因**：竞争分两种——`写-写` 和 `写-读`。裸读与加锁写之间**无 HB**，读可能读到半更新的值，且 `-race` 判定为竞争。
**正确写法**：读也要走同一把锁（或改 `RWMutex` 用 RLock/RUnlock），或改用 `atomic` 发布。

### 坑 4：依赖"加个 sleep 等一等就会看到" 

**现象**：`time.Sleep(time.Millisecond)` 后读共享变量，测试偶尔过、线上偶尔错。
**原因**：sleep 不建 HB。可见性依赖"恰好某次调度的窗口"——纯运气。
**正确写法**：同步用 channel/Once/Mutex；测试里等待用 `Eventually`（同一 channel 机制），别睡。

### 坑 5：`atomic.AddInt64(ptr, 1)` 能"顺便同步所有变量"

**现象**：用 `atomic.AddInt64` 做计数器，以为读它是"全量同步点"，其它变量跟着可见。
**原因**：Go 模型只对**同一地址**的原子访问给 HB；`AddInt64` 只保证该地址的 SC，不发布其它变量。
**正确写法**：计数器可被原子读，但"发布一个完整可变结构"要用 `atomic.Pointer` Store/Load 或锁。

### 坑 6：以为 channel 收发的"量"错了也能同步

**现象**：发 1 个通知，10 个 goroutine 都 `<-ch` 等，结果只有 1 个被唤醒，其余饿死。
**原因**：1 次发送只匹配 1 次接收，只给那 1 个 receiver HB。
**正确写法**：广播用 `close(ch)`（所有 receiver 同时解除、各自获得 HB）；需要多次通知则循环发送或 `sync.Cond`。

### 坑 7：混淆 `sync.Once` 的"字段读写"与"Do 内写"

**现象**：`once.Do` 里写入 `cfg`，`Do` 外的 goroutine 直接 `cfg.Addr` 读——以为"once 帮你同步一切"。
**原因**：`Once` 只保证"Do(f) 的写对后续 Do 返回可见"；**其它 goroutine 直接访问 `cfg` 字段没有 HB**（除非它也是经 Once/Mutex/atomic 到达）。
**正确写法**：**所有**对 `cfg` 的访问者都走同一同步路径（如都 `once.Do` 后读、或 `cfg` 本身是 atomic.Pointer）。

### 坑 8：从 `std::atomic` 的 `relaxed` 思路套过来——过度自信

**现象**：在 Go 里 `atomic.LoadInt32` 加 `atomic.AddInt32` 组合出一个复杂协议，测试过就以为正确。
**原因**：Go 的原子操作**类型化、语义收敛**；但"组合复杂协议"仍然可能依赖了模型不保证的序（如"我会先 Store 后 Load 所以顺序固定"）。
**正确认知**：能用 channel/锁表述的逻辑优先；原子协议留给"读多写少的计数器/标识"这类简单场景。复杂协议回去写 C++ 再用 memory_order 也不迟。

---

## 五、练习任务

- [ ] 复现「坑 1」的 bool 死锁：写 `for !done` 不加同步的 reader，验证可能卡死（用 `time.After` 观察超时）；再用 `close(done)` 修好
- [ ] 写一个无缓冲 channel 传值程序，在 `ch <- v` 前写 `x`，接收后读 `x`，多次运行都用 `-race` 验证无竞态；再改成有缓冲 channel 容量 1 重跑，观察语义差异
- [ ] 对照 C++ 的 `std::atomic<bool>` + `relaxed`:用 Go 的 `atomic.Bool` Store/Load 实现同样的"标志位 + 发布指针"模式，注释里写清两者内存序区别
- [ ] 用 `sync.Once` 实现懒加载单例，另写一个直接裸读 `cfg` 的对手版本，用 `-race` 对比两者谁申告/谁不告，并解释 Why
- [ ] 写错版本（写加锁读裸读）的程序，跑 `go run -race` 看报错信息长什么样，改成 RWMutex 后确认报错消失
- [ ] 用 Mutex 实现「先写后读」的传递性案例：A 写 x、解锁；B 加锁、读 x、解锁；C 加锁、读 B 写的东西——验证三层传递
- [ ] 思考题（对照 C++ 的 TSan）：为什么 `-race` 只在"真正交错的路径"上报？以此设计一个"大概率能触发竞态"的测试，体会动态工具的边界

---

## 六、延伸与参考

- [The Go Memory Model（官方权威）](https://go.dev/ref/mem) — 唯一的规格来源，本笔记全部依据它
- [Go FAQ：Happens Before / data races](https://go.dev/doc/faq#happens_before) — 官方 FAQ 对 happen-before 的通俗解释
- [sync 包文档（Mutex/Once/atomic 类型化 API）](https://pkg.go.dev/sync)
- [Go blog：The Go Race Detector](https://go.dev/blog/race-detector) — race 检测原理与用法
- 相关笔记：[[01-GMP调度模型]]、[[01-goroutine]]、[[02-channel详解]]、[[05-atomic原子操作]]、[[04-sync包-WaitGroup-Mutex-Once]]、[[06-context超时取消与传值]]