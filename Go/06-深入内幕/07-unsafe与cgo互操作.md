# 07 - unsafe 与 cgo 互操作

> C++ 的 `reinterpret_cast` + `extern "C"` 在 Go 里被装进了两个官方包：`unsafe`（打破类型/GC 规则）和 `cgo`（跨语言边界）

---

## 一、简述

Go 追求内存安全，但现实里有三类需求绕不开"不安全"：**解析二进制布局**、**优化热路径**、**调用 C 库**。Go 给的两把钥匙：`unsafe` 包的 `unsafe.Pointer` 允许你绕过类型系统（但仍受 GC 语义约束），`cgo` 允许你直接调用 C 函数（`import "C"` + `//export` 双向互操作）。本章把两者的语义、内存规则、坑、风险一次性讲透——很多线上故障就是从"玩 unsafe 没算清 GC"或"cgo 调用频繁导致线程放大"开始的。

> **核心要点**：`unsafe.Pointer` 像"元指针"，可被 GC 追踪；`uintptr` 只是整数，**GC 不追踪**——所以不允许"把指针存成 uintptr 长期持有"。`cgo` 让你调 C，但每次调用都伴随 goroutine 栈切换与可能的线程膨胀，且 `C.CString` 分配的内存必须自己 `C.free`。`CGO_ENABLED=0` 是纯静态交叉编译的开关，代价是放弃 cgo。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 无类型转换 | `reinterpret_cast<T*>` | `unsafe.Pointer` 转换 | Go 的三步规则更受限，且有 GC 约束 |
| 类型大小 | `sizeof(T)` | `unsafe.Sizeof(x)` | 一样，但 Go 的 `Sizeof` 返回 `uintptr` |
| 对齐要求 | `alignof(T)` | `unsafe.Alignof(x)` | 语义相同 |
| 成员偏移 | `offsetof` | `unsafe.Offsetof(s.F)` | Go 对嵌套/嵌入结构有规则限制 |
| 指针算术 | `p + n`（任意） | `uintptr(p) + n` 转回 | Go 用 uintptr 防 GC 丢对象（坑） |
| 跨语言符号 | `extern "C"` | `//export` / 声明 | Go 还自动处理了 C 的 ABI 与参数传值 |
| 头文件 | `#include` | `// #include <...>` 注释块 + `import "C"` | cgo 注释必须紧跟 import |
| C 字符串生命周期 | `std::string`/手管 char* | `C.CString` → `C.free` | Go 里 C 内存在你的掌控（GC 不管） |
| 跨语言回调 | 函数指针显式传 | `//export` 导出给 C | 回调时 cgo 会切换刻意绑的线程 |
| 交叉编译 | 工具链编译 C 代码 | `CGO_ENABLED=0` 纯 Go | 纯 Go 无 cgo 才能一路交叉到底 |

---

## 三、逐主题详解

### 3.1 `unsafe` 包三件套：Sizeof / Alignof / Offsetof

```go
package main

import (
	"fmt"
	"unsafe"
)

type Header struct {
	Magic  uint16 // 2 字节
	Flags  byte   // 1 字节
	Body   uint32 // 4 字节（需要对齐）
}

func main() {
	h := Header{}
	fmt.Println("Sizeof:", unsafe.Sizeof(h))      // 8（不是 2+1+4=7，有 padding）
	fmt.Println("Alignof:", unsafe.Alignof(h))     // 4（最大成员对齐）
	fmt.Println("Offsetof Magic:", unsafe.Offsetof(h.Magic)) // 0
	fmt.Println("Offsetof Flags:", unsafe.Offsetof(h.Flags)) // 2
	fmt.Println("Offsetof Body:", unsafe.Offsetof(h.Body))   // 4（3 处 padding 1 字节填在中间）
}
```

- `Offsetof` 要求字段是**可寻址**的（`s.F` 形式，不能是未导出字段）。
- 这些原语从 1.0 至今，官方 docs 明确：**`unsafe` 不提供兼容性承诺**，后续版本可能变——但在已知版本内是可靠的。
- C++ 对照：`sizeof/alignof/offsetof` 早已内建，返回 `size_t`；Go 返回 `uintptr`。**布局算法的直觉（对齐、padding）两者完全一致**——你可以把你对 C++ 结构体内存布局的知识直接迁移过来。

### 3.2 `unsafe.Pointer` 与 `uintptr` 的区别（本章最核心）

| 特性 | `unsafe.Pointer` | `uintptr` |
|------|------------------|-----------|
| 本质 | 指针（与 `*T` 同族） | **整数**（地址的编号） |
| GC 追踪 | ✅ 是（对象可达性参与） | ❌ 不是（就是个数字） |
| 可做算术 | ❌ 不能直接 `+n` | ✅ 可以 |
| 可长期保存 | ✅（Go 1.17+ 合法） | ❌ 存久了=可能悬垂 |
| 转换 | `*T` ↔ `unsafe.Pointer` ↔ `*U` | `uintptr(unsafe.Pointer(...))` |

```go
p := unsafe.Pointer(&x)   // &x 是 *int → unsafe.Pointer（合法）
up := uintptr(p)          // 转成整数（此时"失去指针身份"）
_ = up
// ⚠️ 一旦 p 指向的对象被 GC 移动/回收，up 就是"悬垂整数"
//    Go 的 GC 不移动对象，但会回收；up 长期保存=访问已释放内存（未定义行为）
```

**官方三步规则**（Go 文档的『Conversion』/『Restrictions』，一共 7 条），核心是三种合法模式：

1. **`*T1 → unsafe.Pointer → *T2`**：把一段内存换个类型解释（不能扩大访问范围越过原对象）。

```go
var f float64 = 3.14
p := unsafe.Pointer(&f)
// 把 float64 的 8 字节按 uint64 读出（类似 memcpy/reinterpret_cast）
bits := *(*uint64)(p)
fmt.Printf("%x\n", bits) // 3f91eb851eb851ec（IEEE754 位模式）
```

2. **`*T → uintptr`（算术）→ `*T`**：指针算术的唯一通道，但**必须一步到位**，中间值立刻转换回指针使用。

```go
arr := [4]int32{10, 20, 30, 40}
base := unsafe.Pointer(&arr[0])
// 偏移 2 个元素（等价 arr[2]）
p := unsafe.Pointer(uintptr(base) + 2*unsafe.Sizeof(arr[0]))
fmt.Println(*(*int32)(p)) // 30
```

3. **`unsafe.Pointer` 用于 cgo（`C` 包内部）**：`C` 的对象与 Go 跨边界。

> ⚠️ **红线**：`runtime.KeepAlive` 用于"指针值转成 uintptr 后又没在表达式里用回指针"的场景，防止中间态失去 GC 追踪导致对象被回收。更简单的规矩：**不要保存 uintptr 形式的指针**，用完即弃。

### 3.3 `unsafe.Pointer` 解析二进制协议：一个就地读缓冲区例子

```go
package main

import (
	"encoding/binary"
	"fmt"
	"unsafe"
)

// 假设收到一段网络包，头部布局固定：
//   [0:2]  magic  uint16
//   [2:3]  flags  byte
//   [3:7]  seq    uint32
func parseHeader(b []byte) (magic uint16, flags byte, seq uint32) {
	if len(b) < 7 {
		panic("too short")
	}
	// 方法一（推荐，可移植）：显式拆字节
	magic = binary.LittleEndian.Uint16(b[0:2])
	flags = b[2]
	seq = binary.LittleEndian.Uint32(b[3:7])

	// 方法二（unsafe，快但布局强绑定）：直接按 struct 解释缓冲
	// type wireHeader struct { Magic uint16; Flags byte; _ [1]byte; Seq uint32 }
	// h := (*wireHeader)(unsafe.Pointer(&b[0]))
	return magic, flags, seq
}

func main() {
	buf := []byte{0x34, 0x12, 0x01, 0x78, 0x56, 0x00, 0x00}
	m, f, s := parseHeader(buf)
	fmt.Printf("magic=0x%04x flags=%d seq=%d\n", m, f, s) // magic=0x1234 flags=1 seq=0x5678
}
```

> **C++ 对照**：C++ 里你会 `reinterpret_cast<const Header*>(data)` 直接踩内存；Go 的 `unsafe` 也允许，但**还有编码包 `encoding/binary` 这条"可移植"的替代路径**。除非是高频热路径（每秒解析百万个包头），优先 `binary` 包——它不依赖结构体的对齐/padding，且大小端可控。

### 3.4 cgo 入门：最小编译单元

```bash
# 环境确认
go env CGO_ENABLED GOHOSTARCH
```

```go
// mylib.go（同一个目录里）
package main

// #include <stdlib.h>
// #include <string.h>
import "C"

import (
	"fmt"
	"unsafe"
)

func main() {
	// 调 C 库函数（stdlib）：
	buf := C.malloc(C.size_t(8)) // 返回 unsafe.Pointer
	if buf == nil {
		panic("malloc failed")
	}
	defer C.free(buf) // C.malloc 分配的必须先 C.free

	// C 字符串往返
	cs := C.CString("hello from cgo")          // C 堆上拷贝的字符串
	defer C.free(unsafe.Pointer(cs))            // 释放 C 堆内存才算数
	cLen := C.strlen(cs)
	fmt.Println("len:", int(cLen))
}
```

关键语法：
- `import "C"` **前一行的注释块里写 C 代码**（`#include`、声明、甚至整个 C 函数体）；cgo 会把它们编译进本包。
- `C.size_t`、`C.malloc`、`C.CString` 等 C 侧符号按 `C.xxx` 引用。
- `import "C"` **不能出现在 `_test.go` 测试文件里**；且需要 cgo 的包在 `CGO_ENABLED=0` 时编译失败。

### 3.5 C 内存管理：GC 不管 C 堆

**最重要的规则：`C.CString` / `C.malloc` 分配的内存，Go 的 GC 不会释放**，必须自己 `C.free`：

```go
cs := C.CString("some config")   // C 堆上分配字符串
defer C.free(unsafe.Pointer(cs)) // ✅ defer 兜底，别忘了
// 用完后没有 free = C 堆泄漏（valgrind 最爱的现场）
```

```go
// 高效写法：先建 Go 侧 buffer，再让 C 写进来，避免字符串拷贝
// （示意：C 侧声明过 void readBuffer(char* data, int len);）
func callCRead(buf []byte) {
	// 把 Go 切片底层数组的首地址给 C（绕过拷贝）
	cData := (*C.char)(unsafe.Pointer(&buf[0]))
	C.readBuffer(cData, C.int(len(buf)))
	// C 写完返回后，buf 可能"看起来不再被使用"，
	// 必须钉住 buf，防止底层数组在 C 还在访问时被 GC 回收：
	runtime.KeepAlive(buf)
}
```

> ⚠️ **KeepAlive 场景**：把 Go 切片底层指针交给 C 后，如果你"看起来不再用 buf"，编译器/GC 可能提前回收底层数组——C 代码还在写。必须 `runtime.KeepAlive(buf)` 钉住（见 [[03-三色GC与写屏障]] 的 3.11）。

### 3.6 `//export`：把 Go 函数导出给 C 调用

cgo 支持双向：Go 调 C，也能让 C 代码回调 Go。在文件里写：

```go
package main

// #include <stdio.h>
// void call_go(int);
import "C"
import "fmt"

//export helloFromGo
func helloFromGo(n int) C.int {   // 导出函数必须：接收/返回 C 类型，且不能在 main 包内
	fmt.Println("C 调用了 Go, n =", n)
	return C.int(n * 2)
}
// 上面的 //export 会在编译期生成一个 C 可见符号 helloFromGo（int 返回 C.int，
// 若要传字符串请用 *C.char + C.CString，见 3.5）
```

要点：
- `//export` 要求文件有 `import "C"`，且导出函数**签名只能含 C 可表达的类型**（`int64`、`*C.char` 等）。
- Go 字符串/切片不能直接进 C——需要**转换**（`C.CString` / `unsafe.Pointer(&s[0])`）。
- 回调是"反向 cgo"：C 代码在某线程调用 Go 函数时，Go 运行时要把该线程**切换成 Go 协程栈**再跑，有额外开销；且默认只在"被调用时所在的线程"上切换——这就是"cgo 回调会让线程放大"的根源之一。

### 3.7 cgo 与调度器：为什么频繁 cgo 会线程膨胀

从 [[01-GMP调度模型]] 我们知道：进入 cgo 调用的 M 会**抢占 P**（`exitsyscall` 路径），在这段期间：

1. M 被 C 代码"借用"，Go 调度器**看不到**它（C 栈不是 Go 栈，无法抢占）；
2. 其它 G 需要 P 时，运行时可能**新建 M** 顶上；
3. 频繁、短促的 cgo 调用 = 反复 handoff + 可能有 M 数量上涨。

```go
// 反模式：循环里高频 cgo（比如逐字节调 C 的 isalpha）
for i := range data {
	_ = C.isalpha(C.int(data[i])) // 每次触发跨边界调用
}
// ✅ 批量：把一次性把缓冲交给 C 处理一大块,减少跨边界次数
```

**CrossCall 开销量级**：一次 cgo 调用大概几百 ns ~ 1µs（对比普通 Go 函数十几 ns），加上线程放大风险。**能用纯 Go 实现就别 cgo**；必须 cgo 时**减少调用频次、批量传递**。

### 3.8 `CGO_ENABLED=0`：纯 Go 的交叉编译取舍

```bash
# 关闭 cgo（遇到 import "C" 直接编译失败）
CGO_ENABLED=0 go build ./...

# 纯 Go 交叉编译（无 cgo 依赖，天然支持任意 GOOS/GOARCH 三件套）
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o app .
GOOS=windows GOARCH=amd64 go build -o app.exe .   # 默认 Windows 上无 cgo
```

| 取舍 | `CGO_ENABLED=1`（默认） | `CGO_ENABLED=0` |
|------|------------------------|-----------------|
| cgo 能力（import "C"、调 C 库） | ✅ | ❌（编译失败） |
| 依赖 C 库的程序 | ✅（需目标机有库） | ❌ |
| 纯静态可执行文件 | 不一定（`-ldflags="-linkmode=external"` 等） | ✅ 天然纯静态 |
| 交叉编译 | 受限（目标要有 C 工具链） | ✅ 自由 |
| 典型场景 | 系统库交互、性能敏感 C 库 | 云原生/容器/服务器静态部署 |

> 注意几个隐藏项：
> - Go **标准库**一些包在 cgo 开启时行为更优（`net` 的 resolver 可用系统 DNS、`os/user` 可读真实用户库），`CGO_ENABLED=0` 时会退化为内置/纯 Go 实现（DNS 走内置 resolver）。
> - 判断某程序是否真依赖 cgo：`go build -x` 看是否调用了 cgo 步骤，或 `go list -deps` 结合 `import "C"` 溯源。

### 3.9 `unsafe` 的兼容性与 GC 交互：风险边界

- **Go 1.x 兼容性承诺不覆盖 `unsafe`**：官方明确 `unsafe` 语义可能随版本变化（历史上 `unsafe.Pointer` 的算术限制、KeepAlive 引入都改过）。线上用 `unsafe` 要固定 Go 版本、写测试护住行为。
- **逃逸分析对 unsafe 盲区**：`unsafe.Pointer` 绕过编译器变量分析，可能导致编译器无法证明变量安全，从而多逃逸/少逃逸（见 [[02-逃逸分析与内存分配]]）。
- **GC 位图盲区**（见 [[03-三色GC与写屏障]] 的 3.10）：unsafe 转换后的"假类型"让 GC 的指针位图失效，一旦引用关系写错就可能"回收了还被用着"——**这是确定性的未定义行为来源**。
- 唯一建议：`unsafe` 只用在"解释二进制/享受内联优化/对接 C"这三种明确场景，并且**分层隔离**（一个小包封装、测试全面）。

### 3.10 unsafe 的收益到底有多大：先量再改

unsafe 提速的典型来源：
1. **去掉 binary 包的反射式分摊**：逐字段 `binary.LittleEndian.UintXX` 比一记 `*(*Hdr)(unsafe.Pointer(...))` 慢，但只有"解析上亿个包头/大数组"才有量级差异。
2. **避免拷贝/分配**：`string ↔ []byte` 的零拷贝转换、`unsafe` 直接取子结构，能省下逃逸带来的堆分配（见 [[02-逃逸分析与内存分配]]）。
3. **对接 C 布局**：与大块 C 结构体互通时，逐字段转换不可行，就地解释是唯一现实方案。

```go
// 常见 lint 直觉：先量，别为了"性能"立即 unsafe
// 1) 用 pprof / bench 证明热点
// 2) 尝试安全的替代（binary、encoding、复用缓冲）
// 3) 仍不够，才引入unsafe并加注释"为什么一定要 unsafe"
```

> **C++ 对照**：C++ 里 `reinterpret_cast` 零点成本是语言默认；Go 里多数场景还能用安全手段（二进制、json）以「每字段几十纳秒」的代价完成同等工作。**把 unsafe 当"最后手段"，代表你对性能问题的判断——与 C++ 的"默认就能踩内存"是两种文化。**

### 3.11 决定要不要 cgo 的检查清单

| 问题 | 若是，倾向 |
|------|-----------|
| 该能力 Go 标准库/生态有吗？ | ✅ 别 cgo |
| 必须用某个 C 库（SDK/加密/编解码）？ | ⚠️ 只能 cgo |
| 调用频率高、数据量小？ | ⚠️ 风险高，考虑批量/桥接 |
| 你只是想要"原生类型布局"？ | ❌ 用 encoding/binary 或 unsafe，别牵 cgo |
| 目标机没有 C 工具链/想纯静态部署？ | ❌ 考虑 CGO_ENABLED=0 |
| 线上要长期维护、版本升级频繁？ | ⚠️ cgo 构建链（os 依赖）会加重维护 |

决策顺序总结：**先找纯 Go 实现 → 必须 C 则缩小边界成独立小包 → 尽量批量传递 → 固定 Go 版本 + 补 C 侧测试。**

---

## 四、常见坑与误区

### 坑 1：把 `uintptr` 当指针长期存着用

**现象**：`p := uintptr(unsafe.Pointer(&x))` 后存到结构里，几毫秒后再转回 `*(*int)(unsafe.Pointer(p))` 拿到垃圾值/崩溃。
**原因**：`uintptr` 是整数；GC 不知道它是指针，`x` 可能已被回收；且 Noescape 分析中断。
**正确写法**：指针只以 `unsafe.Pointer`（或 `*T`）形式存在，算术用 `uintptr` 但要**同一条语句内用完即回转**（见 3.2 模式 2）。

### 坑 2：`unsafe.Pointer` 越过对象边界读内存

**现象**：`(*[100]byte)(unsafe.Pointer(p))` 但 p 只指向 2 字节——读越界，然后"居然跑起来了"（栈里正好有别的数据）。
**原因**：`unsafe` 不检查边界，越界读写在物理上"能执行"，但=未定义行为，可能读坏、写坏、甚至触发 GC 回收后崩。
**正确写法**：永远把"能合法访问的字节数"与标定一致；读二进制用 `unsafe` 时先 `len(b)` 检查（如 3.3 的 `if len(b) < 7`）。

### 坑 3：`C.CString` 不 free → C 堆泄漏

**现象**：循环里 `cs := C.CString(...)` 忘 `C.free`，RSS（实际物理内存）一直涨，`inuse_space` 却不大（因为泄漏在 C 堆）。
**原因**：Go GC 只回收 Go 堆；`C.CString` 走 C `malloc`。
**正确写法**：`defer C.free(unsafe.Pointer(cs))`；或用 `C.GoString(cs)` 读完就 free；对高频字符串想用 `C.CBytes` + 池化。

### 坑 4：cgo 调用放循环里，线程疯涨到几百个

**现象**：pprof 的 goroutine 显示大量 `syscall`，`threads` 数量爆炸，QPS 反而下降。
**原因**：每次 cgo 都让 M 进 C 栈、释放 P、必要时新建 M；短促高频调用放大了线程数（见 3.7）。
**正确写法**：批量把缓冲交给 C（一次调 C 处理很多数据）；必要时 `runtime.LockOSThread` 钉住一个专用线程做 cgo 高频路径（配合 `UnlockOSThread`）。

### 坑 5：以为 `CGO_ENABLED=0` 只是"小开关"，不知道 DNS/resolver 行为变了

**现象**：线上从 cgo 切纯 Go 后，`net.Dial` 从某个系统域名解析失败。
**原因**：`CGO_ENABLED=1` 时 `net` 用 libc 的 `getaddrinfo`（走系统 `/etc/resolv.conf` + NSS）；`CGO_ENABLED=0` 用纯 Go resolver（自带实现，行为有差异）。
**正确认知**：显式设置 `GODEBUG=netdns=go` 或 `=cgo` 控制 resolver；云原生纯静态部署常用 `CGO_ENABLED=0`+内置 resolver，但要测试系统 DNS 兼容性。

### 坑 6：`//export` 导出函数带 Go 类型（string/slice），编译失败

**现象**：`//export foo  func foo(s string)` 编译报错 `//export requires type ...`.
**原因**：`//export` 函数只能有 C 可表示的类型；Go string/slice/map 无法符号化。
**正确写法**：导出函数全部用 `*C.char`、`C.int64`/定长整数、`unsafe.Pointer` 等；需要 Go 字符串就在内部 `C.GoString` + 转换。没有 `//export` 的函数（给 C 用的普通函数）则没这限制，但 C 侧仍需以 C 类型调用。

### 坑 7：把 `unsafe` 当"最后手段"，却没意识到它的替换品

**现象**：追求性能，日夜想着 unsafe 把 struct 塞 byte slice。
**原因**：把 unsafe 炫技当成必然。
**正确认知**：**先量再改**（见 [[05-pprof性能调优]]）：用 pprof 证明某处真是热点，再考虑 unsafe；同时对比"内存池/`binary`/批量 cgo/减少分配"这些**不改类型系统**的优化。unsafe 是"最后一公里"，不是第一选择。而且用了 unsafe 就要接受 Go 版本升级时可能需要重写的代价。

### 坑 8：从 C++ 带过来"extern \"C\" 只管符号，跨语言传参随随便便"的习惯

**现象**：默认 cgo 传复杂结构体/字符串无脑传，结果参数被 Go GC 回收、或字符串没拷贝即将失效。
**原因**：C 与 Go 有各自的堆/GC；Go 对象生命周期由 Go GC 管，C 侧不参与；字符串在 Go 侧不可变但底层数组可能被 GC 移动（Go 不移动，但仍会回收）。
**正确认知**：跨边界传数据要么 `C.CString` 拷贝、要么 `unsafe.Pointer(&s[0])`+`KeepAlive`，**务必明确"谁分配、谁释放、存活多久"**。这对 C++ 的 `extern "C"`+手动内存是同样的纪律，只是边界两边语言的内存模型不同。

### 坑 9：对 `unsafe` 的结果不写测试、不固定版本——升级 Go 就崩

**现象**：项目用了 unsafe 靠某版本的布局假设，升级 Go 版本后行为变了（比如结构体 padding 变了、`unsafe.Pointer` 那条规则更新）。
**原因**：`unsafe` 不在 Go 1.x 兼容承诺内；布局/束缚随时间演进。
**正确做法**：所有 unsafe 代码**集中到一个小包**，写"边界断言"测试（长度、偏移、往返 bit 位不变），并在 README/注释里**写明测试通过的 Go 版本**；升版本时先跑该包测试。

### 坑 10：把 `CGO_ENABLED=0` 当作"万能静态开关"，却不清楚它真正的取舍

**现象**：项目里有 `import "C"` 的代码，直接 `CGO_ENABLED=0 go build` 报错；或反过来，需要"完全静态"却在 `CGO_ENABLED=1` 下打出的二进制在别的机器跑不了。
**原因**：`CGO_ENABLED=0` 的语义是 **禁用 cgo**——有 cgo 的包直接编译失败；而**真正决定链接方式**的是链接器参数。Linux 上 `CGO_ENABLED=0` 确实得到完全静态的纯 Go 二进制（无 glibc 依赖）；但要"带 cgo + 静态链接"需 `CGO_ENABLED=1` + `-ldflags "-linkmode=external -extldflags=-static"`，并自行解决 C 依赖（如 musl、静态库），并非某个开关一设就万事大吉。
**正确预判**：先分清"是否需要 cgo 能力"（调 C 库）与"是否需要静态链接"（部署环境），分别配置。需 cgo → 目标机要有对应 C 库/工具链；只需纯 Go 产物 → `CGO_ENABLED=0` + 冒烟测试（DNS/用户解析行为见坑 5）。

---

## 五、练习任务

- [ ] 用 `unsafe.Sizeof/Alignof/Offsetof` 打印 5 种结构体（含嵌套、嵌入、数组）的布局，画出内存对齐图
- [ ] 写一个 `float64 → uint64 → float64` 的 unsafe 往返，验证位模式不变（对照 C++ `memcpy`/`reinterpret_cast`）
- [ ] 用 `unsafe.Pointer` + 偏移量读出 `[]int32` 的第 3 个元素，再用 `uintptr` 写法复刻一次，比较两种写法的 GC 风险并在注释说明
- [ ] 写一个 `parseHeader` 用 `encoding/binary`（可移植版）与 unsafe（快版本）各实现一遍，用基准对比二者差异
- [ ] 写一个 cgo 程序调 `C.pow`->`C.strlen`，把 `C.CString`/`C.free` 的配对照写清楚；再用 `CGO_ENABLED=0` 编译同一程序，观察报错并解释
- [ ] 写一个 `//export` 导出函数给 C 回调（C 里 `cgo` 头文件声明的例子），验证来回调用时 Go 侧参数是 C 类型的必要性
- [ ] 对照 C++ 的 `reinterpret_cast`：总结「C++ 的 reinterpret_cast 与 Go 的 unsafe 转换」各自的越界/GC 约束，写一张表
- [ ] 思考题：假设你们项目要调一个 C 库做图像编解码，你会怎么设计 cgo 的接口层（批量、缓冲、KeepAlive、线程策略）？对照 C++ 用 extern "C" 调同一库的差异点

---

## 六、延伸与参考

- [cgo 官方文档（含 //export 与指针规则）](https://pkg.go.dev/cmd/cgo)
- [unsafe 包文档（含转换规则 7 条）](https://pkg.go.dev/unsafe)
- [Go blog: cgo is not Go（性能与线程放大讲解）](https://go.dev/blog/cgo) — 必读
- [The Go Memory Model（unsafe 边界的官方上下文）](https://go.dev/ref/mem)
- 相关笔记：[[01-基础语法/08-指针]]、[[03-三色GC与写屏障]]、[[02-逃逸分析与内存分配]]、[[06-反射reflection]]、[[01-GMP调度模型]]

> 总结一句话：**`unsafe` 是"绕开类型系统但遵守 GC 的钥匙"，`cgo` 是"跨语言边界的桥"——两者的共同铁律：明确所有权、控制边界、先量后改、分层隔离。**