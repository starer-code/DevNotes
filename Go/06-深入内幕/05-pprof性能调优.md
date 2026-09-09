# 05 - pprof 性能调优

> C++ 里要弄 4~5 套工具（perf / valgrind / gprof / TSan）；Go 把 CPU、内存、goroutine、锁的剖面图都装进了一个 `pprof`

---

## 一、简述

性能调优第一步永远不是"猜"，是"量"。Go 的 **pprof**（profile）机制提供一套统一的剖析框架：CPU、堆内存、分配、goroutine、锁竞争、阻塞延时的剖面数据，既能离线抓（`runtime/pprof`、`go test -cpuprofile`），也能在线实时抓（`net/http/pprof`）。配合 `go tool pprof` 的 `top / list / peek / web` 交互和火焰图，你能在几分钟内定位 CPU 热点、内存黑洞、goroutine 泄漏。对用惯 `perf`/`valgrind`/`gprof` 的 C++ 开发者来说，这是一次"多工具合一"的升级。

> **核心要点**：pprof 是**采样式剖析**：按频率打断程序，记录当时正在执行的函数调用栈，最后统计"每个函数在多少样本里出现"。**flat** 是"函数自己耗的"，**cum** 是"含它调用的所有子函数"——读懂这两个数字是使用 pprof 的核心。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| CPU 剖析 | `perf record/report` | `runtime/pprof` + `cpu.prof` | Go 内置采样器，无需 perf_event 权限 |
| 堆内存剖析 | `valgrind --tool=massif` / `heaptrack` | `memprofile` + heap view | pprof 同时给 inuse/alloc 两维度 |
| 线级热点 | `perf annotate` | `go tool pprof -list` | 直接给源码行统计 |
| 火焰图 | `perf script` + 第三方 FlameGraph | `go tool pprof -http`（内链火焰图） | 一命令内建 |
| 死锁/锁竞争 | 手写 + `helgrind` | mutex/block profile | 并发调优必备 |
| 调用图 | `gprof`（编译期插桩） | pprof 自动采样 | Go 无插桩成本，直接采样 |
| 内存泄漏排查 | `valgrind --leak-check` | goroutine profile + `alloc_objects` | Go 看"分配来源"而非"泄漏点" |
| 运行中抓取 | 需 `perf` 权限/SAMPLING | `net/http/pprof` 一键开 | 线上服务开端口即可 |

---

## 三、逐主题详解

### 3.1 profile 是什么：采样式剖析

```
时间轴 ──────────────────────────────────────────►
  采样点：每隔 t（如 100 次/秒 = 10ms）触发 SIGPROF
  每次记录：当前 goroutine 的完整调用栈（PC → 函数名）
  ┌────┐┌────┐┌────┐┌────┐
  │foo ││bar ││foo ││baz │    每个采样点保留栈帧
  │ main││ foo││ main││ foo │   最后统计: foo 出现 3/4 次
  └────┘└────┘└────┘└────┘
```

- **CPU profile**：默认每 10ms（100Hz）采样一次正在执行的 G 的栈。**只有"在 CPU 上运行"的 G 会被采到**——所以纯 IO/阻塞的 goroutine 在 CPU profile 里很低。
- **heap profile**：不是采样，是**快照**。记录"当前存活对象"的分配点（用于看内存滞留）或"累计分配"（`-alloc_space`/`-alloc_objects`，用于看分配山）。
- **goroutine profile**：每个 goroutine 当前栈（含状态），看泄漏。
- **mutex/block profile**：记录锁等待与阻塞事件（需要 `runtime.SetBlockProfileRate` / `SetMutexProfileFraction` 开启）。

### 3.2 离线抓取：`runtime/pprof` 与 `go test -profile`

**方式一：`go test` 直接出谱（最常用）**

```bash
# CPU 剖面（默认 1 秒）
go test -cpuprofile cpu.out -bench=. ./...
# 或 30 秒的普通运行
go test -run XXX -cpuprofile cpu.out ./...

# 内存剖面
go test -memprofile mem.out -bench=. ./...
go test -memprofile mem.out -run NONE ./...
```

**方式二：代码里手动抓（适合带停止的基准）**

```go
package main

import (
	"os"
	"runtime/pprof"
)

func heavyWork() {
	sum := 0
	for i := 0; i < 100_000_000; i++ {
		sum += i
	}
	_ = sum
}

func main() {
	// CPU profile
	f, _ := os.Create("cpu.out")
	pprof.StartCPUProfile(f)
	heavyWork()
	pprof.StopCPUProfile()
	f.Close()
}
```

**方式三：内存快照**

```go
f, _ := os.Create("mem.out")
// ...跑一段让堆里留一堆对象...
runtime.GC() // 可选：先把垃圾收一收，快照更"干净"
pprof.WriteHeapProfile(f)
f.Close()
```

### 3.3 在线抓取：`net/http/pprof`（生产最强武器）

```go
package main

import (
	"net/http"
	_ "net/http/pprof" // 匿名导入即注册 /debug/pprof/*
)

func main() {
	// 拉起 pprof 端口（生产只监听内网/加鉴权）
	go func() {
		http.ListenAndServe("localhost:6060", nil)
	}()

	// ...你的业务 main 逻辑...
	select {}
}
```

打开 `http://localhost:6060/debug/pprof/` 能看到入口页；命令行直接抓：

```bash
# 30 秒 CPU 剖面
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
# 堆快照
go tool pprof http://localhost:6060/debug/pprof/heap
# goroutine（看泄漏）
go tool pprof http://localhost:6060/debug/pprof/goroutine
# 5 秒阻塞剖面（需 SetBlockProfileRate 开启）
go tool pprof http://localhost:6060/debug/pprof/block
```

> ⚠️ **线上暴露风险**：`/debug/pprof` 默认无鉴权。生产必须绑定内网 IP、或放在独立的 mgmt 端口+防火墙，千万别公网裸奔（曾有过真实漏洞）。

### 3.4 `go tool pprof` 交互：读 flat 与 cum

```bash
go tool pprof cpu.out
(pprof) top
(pprof) top -cum
(pprof) list hotFunc
(pprof) peek hotFunc
(pprof) web          # 打开调用图 SVG
(pprof) exit
```

典型输出：

```text
File: myapp
Type: cpu
Duration: 10.02s, Total samples = 2.35s
Showing nodes accounting for 1.83s, 78% of 2.35s
      flat  flat%   sum%        cum   cum%
     0.62s 26.38% 26.38%      0.62s 26.38%  runtime.fastrand
     0.45s 19.15% 45.53%      1.80s 76.60%  encoding/json.(*Decoder).unmarshal
     0.31s 13.19% 58.72%      0.31s 13.19%  runtime.memmove
     ...
```

| 列 | 含义 | 读法 |
|----|------|------|
| `flat` | **函数自己**占的样本时间 | 找"自己烧 CPU"的热点 |
| `cum` | 函数 + 它调用的一切子函数 | 找"整条调用链"的热点 |
| `flat%` / `cum%` | 各自占比 | 热点排序 |
| `sum%` | 累计占比 | 看前 N 项能覆盖多少 |

调试法：
1. `top` 先找 `flat` 最高的"自身热点"；
2. `list xxx` 看具体行（哪一行烧的多）；
3. `peek xxx` 看它被谁调用/调了谁；
4. 必要时 `web` 出图看调用关系。

### 3.5 `-list` 到源码行

```text
(pprof) list unmarshal
ROUTINE ======================== encoding/json.(*Decoder).unmarshal
     0.45s      1.80s (flat, cum) 47.51% of Total
         .          .   45:func (dec *Decoder) unmarshal() {
         .      1.30s   46:    value, err := dec.topValue()
     0.10s      0.10s   47:    if err != nil {
         .      0.40s   48:        return nil, err
         ...
```

`list` 会标注每行的 `flat/cum` 秒数，**哪行有秒数就是瓶颈行**。这相当于 `perf annotate` 的源码级视图，但更直接。

### 3.6 火焰图与 web UI

```bash
# 生成交互式 Web（内建火焰图，也可直接浏览器点点点）
go tool pprof -http=:8080 cpu.out

# Linux 下直接生成 SVG（Web UI 底层）
go tool pprof -web cpu.out
```

火焰图读法：横轴按时间占比，纵轴是调用栈；**找"宽度大且平"的区域是核心热点**，顺着往上叠的窄条看调用来源。Go 的工具链原生支持，无需 `FlameGraph` 脚本。

### 3.7 heap 的两种视角：inuse 与 alloc（`-sample_index`）

```bash
# inuse_space：现在存活占多少（内存滞留/泄漏）
go tool pprof -inuse_space mem.out
# alloc_space：累计分配了多少（分配山，不等于滞留）
go tool pprof -alloc_space -sample_index=alloc_space mem.out
# alloc_objects：累计分配次数（高频小分配场景更直观）
go tool pprof -alloc_objects mem.out
```

| 视角 | 回答 | 典型场景 |
|------|------|----------|
| `inuse_space` | 现在内存被谁占着 | 内存滞留、RSS 高 |
| `alloc_space` | 生命周期总共分配了多少 | 分配大山、GC 压力源 |
| `alloc_objects` | 谁在疯狂分配对象 | 高分配频率、GC 频次高 |

### 3.8 真实排查 3 步走（必须会）

```
第 1 步：抓 CPU 剖面（30s）→ 确认"高峰期 CPU 在干什么"
         go tool pprof http://host:6060/debug/pprof/profile?seconds=30

第 2 步：top 找 flat 最高 → list 定位到行
         (pprof) top
         (pprof) list hotSpot

第 3 步：针对热点做实验（改代码 / 换算法 / 缓存），
         用基准 + 再抓一次剖面验证下降
         go test -bench=BenchmarkHot -cpuprofile cpu.out
```

**排障要点**：如果 `top` 第一行是 `runtime.fastrand`、`runtime.memmove`、`runtime.mallocgc` 这类**运行时函数**，通常不是运行时慢，而是**你的代码在疯狂分配小对象 / 大量拷贝**——顺积木往上叠的调用者才是真凶（用 `peek`）。

### 3.9 block 与 mutex 剖面：并发调优的下半场

```go
import "runtime"

func init() {
	// 开启锁竞争统计（采样比例；1 = 全记录，100 = 1%，推荐 1000 量级）
	runtime.SetMutexProfileFraction(100)
	// 开启阻塞统计（同样有采样比例参数）
	runtime.SetBlockProfileRate(1000)
}
```

```bash
go tool pprof http://localhost:6060/debug/pprof/mutex
go tool pprof http://localhost:6060/debug/pprof/block
```

- `mutex` 显示"谁在持锁时让其它 goroutine 等"，适合找锁粒度重叠。
- `block` 显示"goroutine 在 channel/锁/系统调用上阻塞的时间"，适合找 IO 等待、调度停滞。
- C++ 对应 `helgrind`/`tsan` 的锁分析，但 Go 把两者都归到 pprof 里，取起来更顺。

### 3.10 完整案例：一次 CPU 热点排查全流程

**症状**：线上一个接口 P99 延迟升到 800ms，CPU 80%。

**第一步：抓 CPU 剖面**

```bash
go tool pprof http://10.0.0.5:6060/debug/pprof/profile?seconds=30
```

**第二步：top 判方向**

```text
(pprof) top
      flat  flat%   sum%        cum   cum%
     1.2s  52.40% 52.40%      1.2s 52.40%  runtime.memmove
     0.3s  13.10% 65.50%      2.0s 87.35%  encoding/json.(*Decoder).refill
     0.2s   8.73% 74.23%      1.6s 69.88%  strings.ReplaceAll
     ...
```

**第三步：顺着 memmove 找它的调用者（真凶）**

```text
(pprof) peek memmove
 memmove                   0ms      1.2s   calls from
    1.05s   encoding/json.(*Decoder).scanEnter   ← 每次 0.5MB 的数据整体拷贝
    0.15s   strings.ReplaceAll
```

**第四步：定位源码行**

```text
(pprof) list scanEnter
         .          .  188: for _, b := range input {
     0.9s      0.9s  189:     buf = append(buf, b)   ← 逐字节 append，频繁扩容拷贝！
```

**结论与修复**：`scanEnter` 里逐 `append` 一个个字节进 `buf`，触发多次底层数组扩容+memcpy。改为一次性 `make([]byte, n)` 预分配容量，或 `bufio` 分块读——memmove 从 52% 降到 <5%。

> 这个案例的核心手法：**flat 最火的是运行时函数时，别急着怪运行时；用 `peek` 向上追它的调用者，热点一定藏在你的代码里。**

### 3.11 与 `testing.B` 结合：把"基准-怀疑-验证"闭环起来

```go
func BenchmarkHandler(b *testing.B) {
	payload := buildRequest()
	for i := 0; i < b.N; i++ {
		handle(payload) // 被测函数
	}
}
```

```bash
# 一条命令：基准 + 内存 + CPU 剖面一次拿全
go test -bench=BenchmarkHandler -benchmem \
        -cpuprofile=cpu.out -memprofile=mem.out ./...

# 改代码前后各抓一次，用 pprof -top 对比
go tool pprof -top cpu.out
```

- 基准给出"改了之后 ns/op、allocs/op 降没降"；
- profile 给出"改对地方没有（热点是否转移）"。
- 两者闭环，调优才算落地。C++ 里对应的"benchmark + perf profile"工作流，在 Go 里是同样一条 `go test` 命令。

> ⚠️ 基准/剖析都要注意**预热与稳定**：`-count=3`、`-benchtime=2s` 取中位数；别让 GC 污染单次数字。

---

## 四、常见坑与误区

### 坑 1：只抓 CPU 剖面，内存 GC 问题却只字不提

**现象**：服务 OOM / GC 频繁，直接抓 CPU profile，看不出分配真相。
**原因**：CPU 剖面只告诉你"CPU 在哪烧"，堆分配可以慢吞吞地发生却不占 CPU。
**正确做法**：OOM/GC 场景先抓 **heap（inuse）+ alloc_objects（分配频率）**,对照 GC metrics（见 [[03-三色GC与写屏障]] 的 3.12）。分配源在 `alloc_objects` 里一目了然。

### 坑 2：用 `top` 排序拿 `cum` 当"自己烧 CPU"的结论

**现象**：`top` 里 `encoding/json` 的 `cum` 很高，就认定 json 包慢。
**原因**：cum 高可能是"大量调用者"堆出来的，它自身 flat 低（真正慢的在它调用的子函数）。
**正确做法**：先看 **flat 排序**找自己烧 CPU 的叶子；cum 高的函数再 `peek` 看它内部到底花在哪个子调用。

### 坑 3：在开发机上跑一次 pprof 就下结论

**现象**：开发机 profile 显示某热点，改完之后线上没变化。
**原因**：profile 受负载特征、数据规模、机器差异影响极大。单次短采样噪声多。
**正确做法**：用**真实负载**（压测或用线上引流）抓 30s 及以上，多次对比，结合 `-sample_index` 换视角。pprof 的"相对比较"比"绝对值"可靠。

### 坑 4：内存剖面抓完，拿 `RSS` 对比 `inuse_space` 说"有泄漏"

**现象**：`inuse_space` 显示 200MB，进程 RSS 600MB。
**原因**：RSS 含 GC 缓冲的**空闲 span**、页缓存、goroutine 栈、cgo 分配等，与 Go 堆从不相等（见 GC 的 scavenger 延迟归还）。
**正确做法**：判断"内存泄漏"看 `inuse_space` 随压测时长是否**持续增长且不回落**；RSS 高不等于泄漏。

### 坑 5：`-bench` 里 `-cpuprofile` 只跑了 1 秒，样本太少

**现象**：`go test -bench=BenchmarkX -cpuprofile cpu.out -benchtime=1x`，输出全空或只几个样本。
**原因**：CPU profile 默认时长跟随测试时长；1 次 bench 跑完 profile 就结束了。
**正确做法**：`-benchtime=5s` 或 `-benchtime=100000x` 让采样窗口够长；或对长运行的 `main` 手动 `StartCPUProfile/StopCPUProfile`。

### 坑 6：从 C++ 带过来的"抓不到就加 `-O0`/优化关掉"习惯

**现象**：为了"看得更完整"关掉 Go 编译优化（`-gcflags="-N -l"`）再剖析。
**原因**：阉割优化会改变热点（内联没了、寄存器分配变了），profile 失真。
**正确做法**：**用默认编译**剖析。Go 内联会让栈"少几层"，这是正常现象；想看完整栈用 `go tool pprof` 的 `-trim_path`/`-normalize` 或者看 `-cum` 维度。

### 坑 7：生产直接暴露 6060 给公网

**现象**：pprof 端口开在 0.0.0.0，被人下载源码/栈信息，甚至开 `?gc=1` 触发 GC。
**原因**：`/debug/pprof` 是可以被外部触发的"诊断后门"。
**正确做法**：绑定 `localhost`/内网 IP，或用独立 mgmt 端口 + 防火墙/鉴权（如基本 Auth 中间件）。看看 Prometheus exporter 常用做法：单独端口 + 授权代理。

### 坑 8：两次 profile 比"绝对值"而不是比"占比/相对变化"

**现象**：改完代码，`flat` 从 1.2s 变 0.9s，就宣布优化成功。
**原因**：样本时长、负载波动都会让绝对秒数抖动；关键是**相对占比**是否下降、热点是否转移。
**正确做法**：同一台机器、同一负载下，对比 `top` 里热点的 `sum%` 与排名；并用 `-bench` 的 `ns/op` 做最终裁决。**剖面是地图，基准是尺子。**

### 坑 9：只信火焰图的"宽度直觉"，不看窄条链路的调用来源

**现象**：火焰图某个"大宽条"是 `memcpy`，直接盯 `memcpy` 发呆，不知道改谁。
**原因**：火焰图宽条是"叶子"；真正的调用者（你自己的业务函数）在它**上方**层层叠起来的窄条里。
**正确做法**：从宽条往上找**第一个非标准库、占比较高的函数**，那才是能下手优化的地方。或直接 `go tool pprof -peek memmove` 拿到调用列表。

---

## 五、练习任务

- [ ] 写一个「随机数 + 排序 + json 序列化」的 CPU 密集程序，用 `go test -cpuprofile` 抓谱，`top` 找出 flat 最高的函数
- [ ] 用 `list` 找到某个热点函数的**具体行**，随手在注释标记该行，再用 `-benchtime=5s` 重采一次，观察稳定性
- [ ] 给 3.2 的程序接 `net/http/pprof` 端口，用浏览器 + `go tool pprof` 两种方式各抓一次 CPU 剖面
- [ ] 对照 C++ 的 `perf`：分别在 C++ 和 Go 里对同一个「冒泡排序」做剖面，比较两者的工具链差异与出图流程
- [ ] 造一个"goroutine 泄漏"（`go` 出去永远不退出），用 `/debug/pprof/goroutine` 抓出来，再用 `top -cum` 定位是哪个函数泄漏
- [ ] 造一个「每次操作分配 100 个 1KB 对象」的函数，分别用 `-alloc_objects` 和 `-inuse_space` 抓谱，对比两个视角下热点是否一致
- [ ] 打开 `runtime.SetBlockProfileRate(100)` 与 `runtime.SetMutexProfileFraction(100)`，写一段频繁锁竞争程序，抓 block/mutex 剖面并解读
- [ ] 思考题（对照 `valgrind`/`heaptrack`）：为什么「Go 的堆调试靠分配点统计，C++ 靠引用析构追踪」？两者对"判断泄漏/滞留"各自擅长与不擅长什么

---

## 六、延伸与参考

- [Go blog: Profiling Go Programs](https://go.dev/blog/pprof) — 官方入门（读这篇基本够用）
- [runtime/pprof 文档](https://pkg.go.dev/runtime/pprof) — API 与方案详述
- [net/http/pprof 文档](https://pkg.go.dev/net/http/pprof) — 在线抓取的注册与端点说明
- [pprof 交互命令速查](https://github.com/google/pprof) — google/pprof 仓库（含 `-http`、火焰图参数）
- 相关笔记：[[02-逃逸分析与内存分配]]、[[03-三色GC与写屏障]]、[[01-GMP调度模型]]、[[04-Go内存模型-happens-before]]、[[04-工程化/02-测试-单元-表格驱动-基准-覆盖率]]