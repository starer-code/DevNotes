# 01 - GMP 调度模型

> C++ 里你要手写线程池、任务队列、负载均衡；Go 用 G/M/P 三件套在运行时层面把它全包了

---

## 一、简述

goroutine 不是 OS 线程，它比线程轻几个数量级。让几十万 goroutine 复用少数几个内核线程的，就是本章主角——**GMP 调度模型**。学完你会明白：`go func()` 背后发生了什么、为什么 goroutine 能在系统调用阻塞时"让位"、`GOMAXPROCS` 到底是什么、以及 M:N 用户态协程调度器是如何设计的。

> **核心要点**：**G**（goroutine，任务）、**M**（Machine，OS 线程，工人）、**P**（Processor，调度上下文，工位）。P 的数量才是真正同时跑的 "线程数"，G 挂在 P 的本地队列上排队执行，M 抢到 P 才干活。运行时自动完成了 C++ 里你手写线程池 + 任务队列 + work-stealing 的全部工作。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 并发执行单元 | `std::thread` | goroutine (G) | `std::thread` 直接映射 OS 线程，G 是用户态任务 |
| 线程池 | 自写 / `BS::thread_pool` 等 | 内置 GMP | Go 运行时自动复用 M，无需自建池 |
| 任务队列 | `std::queue<std::function>` + mutex | P 本地队列 runq | 每个 P 有 256 长的本地队列，另有全局限队列 |
| 线程数量 | 自己定 / `std::thread::hardware_concurrency` | `GOMAXPROCS`（默认 = CPU 核数） | P 的数量决定并行度，M 可多于 P |
| 线程阻塞迁移 | 无自动机制 | M 阻塞时 P 移交 | 系统调用/锁阻塞时，P 被交给其它 M 继续执行 G |
| 栈 | 固定大小（默认 1~8MB） | 初始 2KB，动态增长 | G 栈可扩容，按需分配 |
| 让出 CPU | 无（靠 OS 时间片） | `runtime.Gosched()` | G 主动让出 P，避免饿死其它 G |
| 抢占 | 内核时间片抢占 | 运行时信号抢占（Go 1.14+） | 协作式 + 抢占式混合 |
| work-stealing | 手写 | 内置 | 空闲 P 偷其它 P 的队列任务，均衡负载 |
| 主线程 | `int main()` | `m0` + `g0` | 运行时专用线程和调度 goroutine |

---

## 三、逐主题详解

### 3.1 三个字母分别是什么

```
┌──────────────────────────────────────────────────────────────┐
│                    GMP 关系示意                              │
│                                                              │
│   G (goroutine)         M (machine)         P (processor)    │
│   ┌──────┐             ┌───────┐           ┌─────────────┐   │
│   │ 用户 │             │ 内核  │           │ 调度上下文  │   │
│   │ 代码 │──调度于──→  │ OS线程 │──绑定于──→│ 本地队列    │   │
│   │ 栈G  │             │ 栈M   │           │ runq[256]   │   │
│   └──────┘             └───────┘           └─────────────┘   │
│      任务                  工人                  工位         │
└──────────────────────────────────────────────────────────────┘
```

- **G（goroutine）**：一个待执行的函数 + 它的栈 + 上下文（寄存器现场）。创建的每个 `go func()` 都对应一个 G。它**只是任务元数据**，不是执行载体。G 结构体字段很长（`src/runtime/runtime2.go`），核心有栈描述 `stack`、当前函数 `sched`（保存 PC/SP）、状态 `atomicstatus`、所属 P 的指针、是否可被抢占等。
- **M（Machine）**：真实的 OS 线程，由内核调度。M 负责真正执行 G 的机器码。创建 M 要付出系统调用成本（约 1MB 内核栈 + 内核结构，线程栈），远贵于创建 G。M 通常不超过几千个，且**有上限**（受系统资源约束，默认 `maxmcount=10000`）。
- **P（Processor）**：你可以把它理解成"工位/许可令牌"。P 里有**本地可运行队列 runq**（长度 256）。G 想被调度运行，必须先被放进某个 P 的 runq，然后 P 绑定到某个 M 上执行队列里的 G。
- **P 的数量 = `GOMAXPROCS`**（默认取 CPU 逻辑核数），它决定了**同一时刻真正并行执行的 goroutine 上限**。P 多了，并行度就高；P = 1 时行为接近单线程。

> **C++ 对照**：M ≈ 一个真正运行在 CPU 上的线程；P ≈ 每个线程手头那个任务队列；G ≈ 任务队列里的任务项。你写线程池时是"一个线程，抢全局任务队列"，Go 优化成"每线程一队列 + 偷取"，减少锁竞争。
>
> ⚠️ 还有一个容易混淆的点：**M 的数量不等于并行度**。M 可以比 P 多（阻塞在 syscall 的 M 挂着，新 M 顶上来），但**只有拿到 P 的 M 才能执行用户 G**。没有 P 的 M 干不了活，只会阻塞、偷 P、或休眠。

### 3.2 调度循环：从 `go func()` 开始

`go func()` 的执行流程：

```
        go func() { ... }()
                │
                ▼
        创建结构体 G
        （初始栈 2KB，状态 Grunnable）
                │
                ▼
   放入当前 P 的本地队列 runq
      （若 runq 满则放入全局队列 sched.runq）
                │
                ▼
     M 从 P 的 runq 取出 G
      （状态 Grunnable → Grunning）
                │
                ▼
     M 切换栈到 G 的栈，跳进 G 的函数体执行
      （从 M 的 g0 切到 G 的 g0 栈，恢复寄存器现场）
                │
                ▼
   G 执行结束 / 阻塞 / 被抢占
      （g0 重新接管，进入 schedule() 循环选下一个 G）
```

调度循环的核心在 `runtime/proc.go` 的 `schedule()`：它按顺序尝试——从 P 本地队列拿一个 G → 定时从全局队列拿一批 G（约每 61 次调度）→ 没有就 `findrunnable()`（无锁自旋、偷取其它 P 尾部任务、最终休眠）。

关键点：

1. **本地优先**：`go func()` 生成的 G 优先放当前 P 的本地队列，访问它**不需要全局锁**（runq 用环形数组 + 原子头尾指针），所以创建 goroutine 极快。
2. **全局队列是"溢出桶 + 补给站"**：本地队列满了才放全局；`GOMAXPROCS` 变化时重新分配。全局队列用一把大锁保护，访问成本高，因此调度器刻意**每 61 次调度才从全局取一次**，保证长时间没机会执行的 G 不会被饿死（"饥饿机制"）。
3. **Work-stealing（偷任务）**：某 P 的本地队列空了、全局也没任务时，它会**随机偷**其它 P 队列**尾部**的任务（偷尾部是为了不破坏对方"刚入队的任务先执行"的语义），把负载"摊平"。这替代了 C++ 线程池里你手写的"抢全局队列 + 自旋等待"。
4. **抢占式调度**：Go 1.14 之前只有协作式（靠 `Gosched`、函数入口插桩），一个死循环 G 能把整机卡死。Go 1.14 起引入**异步抢占**——运行时维护一个 `sysmon` 监控线程，扫描到某个 G 在 P 上连续执行超过 `10ms`，就给该 M 发一个**信号**，在寄存器现场中注入抢占（把 G 标记为需要 bailout），让它在下个安全点让出 P。一个 `for { }` 空循环不再能饿死其它 G。

### 3.3 M 阻塞时：P 的移交

这是 GMP 最精妙的设计。M 执行 G 时可能发生两种"卡住"：

- **阻塞在"纯用户态"锁/chan（不进内核）**：运行时知道是短阻塞，直接 park 当前 G，在**同一 M** 上调度下一个 G。M 不换，零成本。
- **阻塞在系统调用 / 内核态（`syscall`，如 `read` 文件、`pipe`、`cgo` 调用）**：M 真的挂起了，无法再执行任何 G。此时运行时会立刻：
  1. 把当前 M 与 P 解绑（记录 M `oldp` 以便回来）；
  2. 让 P 带着它的 runq **移交**给另一个空闲 M（`handoff`，优先唤醒休眠 M，没有了才新建 M）继续执行队列里的 G；
  3. 系统调用返回后，原来的 M 尝试**抢回**之前那个 P（`exitsyscall`），P 被别人占了就抢别的空 P，没有空 P 就把自己清成「该腐烂的 M」进休眠池待命（M 会复用，不轻易重建销毁）。

```
  时间线：G 做 syscall 阻塞
  M1 ─┬─ 执行 G1 ──→ G1 进入 syscall
      │
      └─ M1 阻塞（内核里睡着）────────┐
                                      │ 运行时发现 M1 卡住(handoff)
  P ───────────── 与 M1 解绑 ────────→ 绑定到空闲 M2
                                      │
  M2 ──→ 继续从 P.runq 取 G2、G3… 执行（用户无感知）

  而 M1 醒来后:
  M1 ──→ 尝试拿回 P（被占则找别的空 P，都没了就休眠等待）
```

> **C++ 对照**：C++ 里一个线程阻塞在 `read()` 时，其它任务只能靠别的线程池线程兜底——你得自己设计"任务帮取、线程池扩容"。Go 的 P 移交机制把这个过程自动化：**阻塞的是"工人"不是"工位"，工位立刻换人**。
>
> ⚠️ 注意：`cgo` 调用外部 C 代码时，执行 cgo 的 M 会**独占**（cgo 调用期间跑的是 C 栈，`ccall` 期间 P 会解绑，但 goroutine 不能跨线程走），因此 cgo 调用频繁时并行度可能被"吃掉"且可能出现线程放大。能用纯 Go 别轻易 cgo（详见 [[07-unsafe与cgo互操作]]）。

### 3.4 `runtime.Gosched` 与 `GOMAXPROCS` 实战

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
)

func main() {
	// 查看 / 设置 P 数量（控制并行度）
	fmt.Println("当前 CPU 核数:", runtime.NumCPU())
	fmt.Println("当前 P 数量(GOMAXPROCS):", runtime.GOMAXPROCS(0))

	// 演示 Gosched：主动让出 P，给其它 G 机会
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 3; j++ {
				fmt.Printf("G%d 第 %d 轮\n", n, j)
				runtime.Gosched() // 主动让出，调度器换一个 G 上来
			}
		}(i)
	}
	wg.Wait()
}
```

```bash
# 限定使用 2 个 P（并行度 2），哪怕机器有 32 核
GOMAXPROCS=2 go run main.go
# 运行时改：在 main 开头调用 runtime.GOMAXPROCS(2)
```

- `GOMAXPROCS`：只影响**同时执行的 goroutine 数**，不影响总 goroutine 数。调大不总是快——切 P 上下文、GC 标记的并发度、CPU 缓存局部性都会跟着变；调小能降低多核带来的缓存竞争。典型服务保持默认即可；容器里记得看 `GOMAXPROCS` 是否被 quota 限制（`automaxprocs` 库可以按 cgroup quota 校正）。
- `Gosched`：用户态主动让渡。适合"某些 G 是 CPU 密集、不想饿着 IO 型 G"的场景。C++ 里最接近的是 `std::this_thread::yield()`，但 `yield` 是让给内核线程调度；`Gosched` 是纯用户态在 G 之间切换，**快得多**。
- 注意 `Gosched` 与 `time.Sleep(0)` 区别：`Sleep(0)` 也走让出路径但带 timer 逻辑；极端低延时段用 `Gosched`。

### 3.5 m0 与 g0

- **m0**：进程启动时内核创建的第一个 OS 线程（即 `main` 所在线程），它是所有 M 的"始祖"，负责启动运行时、初始化调度器、创建其它组件。
- **g0**：每个 M 都有一个专属的 **g0**——它不跑用户代码，只跑**调度器 / GC / 信号处理等运行时系统代码**。G 之间切换的"中枢"就是 g0。还有一个全局 `g0` 在最早期执行初始化与 `main` 引导。
- 普通 G 与 g0 的区分：g0 用的是 OS 自带的栈（固定大小），普通 G 用的是动态增长的堆栈。**切换 G 要比切换内核线程便宜得多**：只需几十条指令保存/恢复寄存器（`save` 当前 G 的 PC/SP、`load` 目标 G 的），不经过内核。
- `proc.go` 里 `mcall` / `gogo` / `bindm` 是切换现场的关键函数。理解这一点就理解了"用户态线程为什么两百纳秒就能切一次"。

### 3.6 一个 G 的生命周期状态机

```
Gidle(新建) ──→ Grunnable(可运行,在某 runq) ──→ Grunning(正跑)
                     ▲                                │
                     │             阻塞(锁/chan/IO)    ▼
                 唤醒后重新入队                  Gwaiting(等待)
                     │                                │
                     │                syscall 返回后    │
                     │                重新入队         ▼
                     └─────────────  syncsyscall ◀── syscall(系统调用)
                                                      │
                                                    结束
                      Gdead(执行完) ◀── GfreedList ────┤
                     （进 gFree 池复用，栈缓存）
```

- G 执行完不销毁，进 **P 的 gFree 池**复用（栈也缓存），这是"创建 goroutine 极便宜"的深层原因——大多数 G 都是循环复用，真正的分配只发生在池空时。
- 一个 G 卡在 `channel` 收发上就是 `Gwaiting`；饿太久或被 `sysmon` 检测到它在一个 P 上跑了超过 `10ms` 就是被动抢占，重新入队。
- 状态字段 `atomicstatus` 用原子位掩码表示，配合 `gscanstatus` 处理与 GC 扫描的并发，防止"正在扫描它的栈时它又跑到另一个 M 上"。

### 3.7 goroutine 的栈：不是固定 2KB，而是"动态增长"

```go
package main

import "fmt"

func recurse(n int) int {
	if n == 0 {
		return 0
	}
	return 1 + recurse(n-1) // 深度递归，栈压力全压在动态增长上
}

func main() {
	fmt.Println("深度 100 万的递归:", recurse(1_000_000))
}
```

- 初始栈 2KB，当栈不够用时触发 **stack growth**：分配一块新的、更大的栈（约翻倍），**把旧栈内容拷贝到新栈**。因为 Go 的栈在堆上，且编译器在每次函数调用边缘生成 **栈增长检查（栈分裂检查 prologue，旧称 stack split）**——检查 SP 是否越过当前栈底，越过了就调用 `morestack` 进入增长流程。
>- Go 1.3 起把"分段栈"改为 **连续栈 + 按需拷贝增长**：栈不够时分配一块更大的、把旧内容拷过去，简化了跨段指针回溯的复杂度；这就是今天"初始 2KB、可长到 1GB"的栈模型。
>- **goroutine 栈在堆上**：首次调度需要时从分配器取，增长也在堆上完成，因此"栈"与"堆"在 Go 里是同一片地址空间的两种布局（见 [[02-逃逸分析与内存分配]]）。
- 因为栈会长大，**不要用指针在递归里把栈内变量的地址跨层长期保存**——旧栈被释放拷贝后，悬挂指针会指向无效内存。Go 逃逸分析和 GC 会尽量帮你，但 `unsafe` 场景自求多福。
- 栈上限 `maxstacksize` 约 1GB；超出会 `panic: goroutine stack exceeds 1000000000-byte limit`。

### 3.8 `schedtrace` 实操：看调度器在做什么

```bash
# 打印调度器执行轨迹（每秒 1 次）
GODEBUG=schedtrace=1000 go run main.go

# 更详细：把每个 P/M 的状态都打出来（配合 scheddetail）
GODEBUG=schedtrace=1000,scheddetail=1 go run main.go
```

输出解读（一行示例）：

```
SCHED 0ms: gomaxprocs=8 idleprocs=0 threads=9 spinningthreads=1 idlethreads=0 runqueue=0 [2 3 0 1 0 3 0 0]
```

| 字段 | 含义 |
|------|------|
| `gomaxprocs=8` | 8 个 P |
| `idleprocs=0` | 没有空闲 P，全部在工作 |
| `threads=9` | 当前 9 个 M |
| `spinningthreads=1` | 1 个 M 在无锁自旋找活干 |
| `runqueue=0` | 全局队列 0 个 G |
| `[2 3 0 ...]` | 每个 P 本地队列的长度 |

> 观察技巧：若 `runqueue` 长期很大，说明任务积压、并行度不足；若 `threads` 长期巨大，说明有大量 syscall/cgo 阻塞导致线程被放大。

### 3.9 调度器演进简史（为什么是今天这个样子）

| 版本 | 亮点 | 解决了什么 |
|------|------|------------|
| Go 1.0 | 最早 GMP 雏形，M:N 调度 | 比 `pthread` 1:1 轻量得多 |
| Go 1.1 | 引入 P 抽象 | 解决多 M 抢全局锁的瓶颈，每 P 本地队列 |
| Go 1.3 | 连续栈（拷贝增长）取代分段栈 | 简化栈管理，去掉分段指针回溯难题 |
| Go 1.5 | 抢占式调度优化 + 运行时大幅提速 | 每 61 次全局补给、让出竞争等 |
| Go 1.14 | **异步抢占**（信号中断） | 结束"死循环饿死其它 G"时代 |
| Go 1.17+ | **寄存器调用约定（register ABI）** | 函数调用/栈上参数搬运成本大降，连带着调度切换更便宜 |

> **C++ 对照**：这一演进路线的终点几乎就是你手写线程池时踩过的所有坑的"最优解"：全局锁→分队列、竞争→work-stealing、协作→抢占、固定栈→动态栈。理解了 GMP，你回头看 C++ 线程池代码，很多"为什么这么设计"的困惑会被解开。

### 3.10 调度器设计 vs C++ 线程池：一张对照表

| 设计点 | C++ 手写线程池 | Go GMP | 注释 |
|--------|----------------|--------|------|
| 任务怎么入队 | 全局 pending 任务队列 + 一把 mutex | 每 P 本地无锁 runq + 全局补给 | 无锁路径占 99% 场景 |
| 空闲线程干什么 | 轮询队列 / `condition_variable` 唤醒 | findrunnable：自旋 → 偷取 → 休眠 | 空转 vs 偷取是本质差别 |
| 任务量大导致热点 | 锁竞争严重 | 本地队列 + 随机偷取摊平 | 摊平靠的是"偷"而非"抢" |
| 线程阻塞 | 阻塞 → 队列积压 | P 移交，新 M 顶上 | 阻塞的是 M 不是 P |
| 栈管理 | 线程栈固定、预分配或建大 | 2KB 起步、按需增长 | 昂贵在线程栈 |
| 公平性 | 靠 FIFO，可能存在饿死 | 全局补给（61 次）+ 抢占 | 主动防饿死 |

### 3.11 观测运行时状态：三个实用 API

```go
package main

import (
	"fmt"
	"runtime"
)

func main() {
	// 1. 当前活跃 goroutine 数量（写监控/限额时常用）
	fmt.Println("goroutine 数:", runtime.NumGoroutine())

	// 2. 当前进程里的线程数（对应 M 的数量）
	fmt.Println("线程数:", runtime.ThreadCreateProfile(nil))

	// 3. 栈信息打印 —— 崩了会打印，平时也能自己打
	// runtime.Stack(buf, true)  // 第二个参数 all=true 打全部 G
	// debug.PrintStack()

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Printf("堆上分配: %d KB\n", m.HeapAlloc/1024)
}
```

配合 `net/http/pprof` 的 `/debug/pprof/goroutine` 页面，你可以看到**每个 G 当前停在哪个函数、什么状态、对应堆栈**——这是排查 goroutine 泄漏的原子弹（详见 [[05-pprof性能调优]]）：

```bash
# 从 6060 端口导出 goroutine profile
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

### 3.12 G 状态速查表（对照 `proc.go` 里 `_Gxxx` 常量）

| 状态 | 含义 | 在 C++ 里对应 |
|------|------|---------------|
| `_Gidle` | 刚分配，尚未入队 | 任务对象已 new 未提交 |
| `_Grunnable` | 在某个 runq 排队，可运行 | 任务在队列中等待线程取走 |
| `_Grunning` | 正在某 M 上执行 | 线程正在执行任务 |
| `_Gwaiting` | 阻塞（锁/chan/IO/系统调用/GC） | 线程 sleep/park |
| `_Gsyscall` | 正在执行系统调用（M 在 syscall） | 线程在 syscall |
| `_Gpreempted` | 被抢占（Go 1.14+，等待被重新调度） | 线程被内核抢占 |
| `_Gdead` | 执行完，挂在 gFree 池待复用 | 任务已销毁，对象入池 |
| `_Gcopystack` | 栈正在增长拷贝，暂停执行 | —（C++ 无） |

> 常见排障线索：pprof goroutine 页面里，大量 `_Gwaiting` 在同一个 `chan receive` 上 = 典型的"生产端死掉，消费端全睡死"；大量 `_Gsyscall` = 线程放大（syscall/cgo 过多）。

---

## 四、常见坑与误区

### 坑 1：以为 goroutine 越多越好 → 内存与调度都饱和

**现象**：无脑 `go func()` 泄漏，程序变慢甚至 OOM。
**原因**：G 初始栈 2KB、还会增长；每个 G 都要占 P 的调度时间。十万 G 可以，百万 G 会吃光内存，且调度扫描（每 61 次全局队列补给的扫描等）变慢。
**正确认知**：goroutine 是"便宜"不是"免费"。**有界并发**用 worker pool（G + channel）或信号量限制，不要 `for` 里无限 `go`。

### 坑 2：在 goroutine 里跑 `for { }` 死循环（旧版型号认知）

**现象**：Go 1.14 之前一个空循环能把其它 G 全部饿死。
**原因**：旧版只有"协作式 + 编译器插桩"抢占，空循环没有函数调用位点，永远轮不到别的 G。
**正确认知**：Go 1.14+ 已通过信号异步抢占，`for{}` 会被强制打断；但**无函数调用深度很浅的自旋仍有抢占延迟**（约一个 `10ms` 检查周期）。真实代码别写无体自旋；要限速等待用 `timer`/`chan`，别用 CPU 空转。

### 坑 3：把 GOMAXPROCS 调到很大"加速"

**现象**：`GOMAXPROCS=256` 反而更慢。
**原因**：P 多 → M 多 → 真上下文切换、CPU 缓存（L2/L3）命中率下降、GC 标记并发 worker 变多（`gcController` 按 P 数分配）、锁竞争加剧。
**正确认知**：默认取核数是常规最优。IO 瓶颈不是加 P 能解决的；CPU 密集瓶颈也只需 ≈ 核数。先 pprof 定位（见 [[05-pprof性能调优]]），再决定动 `GOMAXPROCS`。容器场景关注 quota：`GOMAXPROCS` 默认读的是主机的核数，非 cgroup 限制，必要时用 `automaxprocs`。

### 坑 4：用 C++ 的"每线程一个栈 1MB，几十个线程就到顶"来估算 goroutine

**现象**：估算"一个 goroutine 1MB，4GB 内存只能 4000 个，Go 骗人"。
**原因**：把 G 当成了 `std::thread`。G 初始只占 2KB 栈 + 元数据，且**栈按需增长**，休眠 G 只留微小结构。
**正确认知**：成千上万的 G 是常态；内存大头来自**活跃且栈已增长**的 G。长递归、大局部数组会让单个 G 栈长到很大（上限 1GB）。所以"十万个都不干活的 G"很便宜，"十万个都在深递归的 G"很贵。

### 坑 5：在 main goroutine 里 `sleep` 等子 goroutine —— 误以为"凑合能等"

**现象**：`time.Sleep(time.Millisecond)` 后子 G 逻辑没跑完，输出随机缺失。
**原因**：`main` 返回即进程退出，不等待任何 G（没有进程级 join）。调度顺序也不保证（G 在哪个 P、跑多久都看调度器）。
**正确写法**：一切收尾同步用 `sync.WaitGroup`（`Add` 在 `go` 前）或 channel（见 [[04-sync包-WaitGroup-Mutex-Once]]），绝不用 sleep 猜时间。

### 坑 6：C++ 老手手动"限并发 = 新开线程"，Go 里还用 Mutex 包计数

**现象**：为了限制并发数，维护一把 `sync.Mutex` + 计数器，代码又锁又等待。
**原因**：样板代码复刻。Go 有更地道的 `chan` 信号量。
**正确写法**：

```go
sem := make(chan struct{}, 10) // 容量 10 的信号量
for _, task := range tasks {
	sem <- struct{}{} // 满 10 会阻塞，天然限流
	go func(t Task) {
		defer func() { <-sem }()
		process(t)
	}(task)
}
```

### 坑 7：C++ 里"线程有优先级/亲核性"的直觉套到 Go

**现象**：想用 `nice`、`pthread_setaffinity` 那样控制 goroutine 的优先级/绑核。
**原因**：Go 调度器**没有用户可见的优先级**，也没有公开的亲和性 API。G 的调度顺序只受本地队列顺序、全局补给、抢占时间影响（RIIR 风格：实现细节会变）。
**正确认知**：想控制相对顺序就用 channel/锁/`WaitGroup` 显式同步；想绑核就 `runtime.LockOSThread`（配合 cgo 或 C 库时常用），但需意识到该 M 被独占、不参与调度——务必要在明确的场景用，并在结尾 `UnlockOSThread`。

### 坑 8：误解"协程不会阻塞"

**现象**：既然 goroutine 是用户态协程，就以为 `Read` 文件不会卡住谁。
**原因**：**同步 IO 依然会阻塞 M**（进入 syscall），只是 P 会交接；net 包的 IO 是异步的（运行时用 epoll 把文件描述符准备好再唤醒 G），所以 `net.Conn.Read` 不占 M——但**os.File 的 Read 是真正的 syscall**，会付出 P 移交成本。
**正确认知**：服务端写 IO 尽量走 `net` / `os.Pipe` 这种由运行时轮询的设施；文件密集型 IO 用 `os.File` 时注意并发度与线程放大，或用 `io` 相关带缓冲方案。

---

## 五、练习任务

- [ ] 写程序打印 `runtime.NumCPU()`、`GOMAXPROCS(0)`，用 `GOMAXPROCS=1` 和 `GOMAXPROCS=8` 分别跑一个「4 个 G 各打印 1 万次」的程序，比较输出的交错模式，理解 P 数量对并行度的影响
- [ ] 写一个程序：主 G 里 `runtime.Gosched()` 前后打印顺序，注释对比 C++ 的 `std::this_thread::yield()`，观察"用户态让出比内核态让出快"
- [ ] 用 `GODEBUG=schedtrace=1000` 运行一个高频任务程序，看 `SCHED` 日志里 `gomaxprocs / runqueue / [各 P runq 长度]` 字段，对照本笔记 3.8 节解释一行日志
- [ ] 对照 C++ 的 `std::thread`：分别用 C++（`std::thread`+手写队列）和 Go（G + 有缓冲 channel）实现 100 个任务的并发执行，对比代码量，并尝试创建 10 万任务观察两者的资源差异
- [ ] 在 goroutine 里做一次 `time.Sleep`（纯用户态阻塞）和一次大文件 `os.File.Read`（进入 syscall），用 `schedtrace` 观察后者是否出现 P 移交/线程放大
- [ ] 写一个死循环 goroutine 的程序，分别用 Go 1.13 之前思路（纯协作式注释推理）和当前版本跑，体会抢占式调度，并记录它仍可能造成的抢占延迟
- [ ] 思考题：为什么 `findrunnable` 时调度器要先"无锁自旋"再"休眠"？与 C++ 线程池的空转和 `condition_variable` 对比，两种策略各自的取舍是什么

---

## 六、延伸与参考

- [runtime/proc.go 源码](https://go.dev/src/runtime/proc.go) — 调度器核心实现，重点看 `schedule()`、`findrunnable()`、`handoff()`、`systemstack()`
- [Go blog: preemptible and resumable goroutines](https://go.dev/blog/preemptible) — 抢占式调度设计介绍
- [The Go Programming Language Specification — Go statements](https://go.dev/ref/spec#Go_statements) — `go` 语句语义
- [Go 官方文档：GOMAXPROCS](https://pkg.go.dev/runtime#GOMAXPROCS) — 运行时 API 说明
- 相关笔记：[[01-goroutine]]、[[02-channel详解]]、[[04-sync包-WaitGroup-Mutex-Once]]、[[03-三色GC与写屏障]]、[[05-pprof性能调优]]