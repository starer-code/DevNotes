# 06 - context 超时取消与传值

> C++ 没有直接对应的东西——它最接近 std::jthread 的 stop_token：一个穿过调用链的「取消令牌 + 截止时间 + 键值袋」

---

## 一、简述

`context.Context`（标准库 `context` 包）是 Go 并发中**传播取消信号、截止时间与请求级数据**的载体。它贯穿整个标准库（HTTP 请求、数据库、RPC），是每一个「可能被取消的耗时代码」的标配第一参数。

它解决 C++ 里三个长期痛点：
1. **传递取消信号**：深调用链中，任何一层想取消整条链，怎么办？C++ 用 `std::atomic<bool>` 到处传 + 检查，或 `std::jthread` 的 `stop_token`。Go 里就是 `ctx.Done()` + 广播。
2. **传递截止时间**：每个函数都检查「现在是不是超时了」很烦。Go 里 `context.WithDeadline` 一路带过去，子任务自己查 `ctx.Done()`。
3. **传递请求级数据**：分布式的 trace id、用户信息等「横切数据」，Go 用 `WithValue` 携带，避免每个函数都加参。

> **核心要点**：**`context.Context` 只做三件事：取消（Cancel）、截止（Deadline/Timeout）、传值（Value）。** 它不是「任意全局状态袋」，不该往里塞业务对象；也不是给每个函数都强加的仪式，而是给「可能被取消的耗时代码」用的。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 取消令牌 | `std::stop_token` / 手写 `atomic<bool>` | `ctx.Done()` + 树形传播 | Go 一次 cancel 广播整棵子树 |
| 超时取消 | `std::stoptoken` + 手算时间 | `context.WithTimeout(ctx, 3*time.Second)` | 一行完成「到时自动 cancel」 |
| 截止时间 | `steady_clock::now() + d` 自己算 | `context.WithDeadline(ctx, t)` | Go 语义是绝对时刻 |
| 手动取消 | 手写 `atomic<bool>` + 到处检查 | `cancelFunc()`（WithCancel 返回） | cancel 是「广播」，不只本层 |
| 关联请求数据 | 线程局部 / 全局 map（危险） | `context.WithValue(parent, key, val)` | Go 类型安全 + 随 ctx 走 |
| goroutine 收尾 | `jthread.request_stop()` + join | `select { case <-ctx.Done(): ... }` | Go 惯例：非主路径用 select 监听取消 |
| 取消原因 | 无 | `ctx.Err()` → `context.Canceled` / `DeadlineExceeded` | 区分「被取消」与「超时」 |
| 上下文传播 | 无（要么传 token，要么全局） | 函数第一参数约定 | Go 靠约定 + vet 检查不传 nil |

---

## 三、逐主题详解

### 3.1 两个根：`context.Background()` 与 `context.TODO()`

```go
package main

import (
    "context"
    "fmt"
)

func main() {
    // Background：程序的「根上下文」，所有 context 树的起点
    ctx := context.Background()
    fmt.Println("Background Err =", ctx.Err()) // nil（永远不会被取消）
    fmt.Println("Background Done =", ctx.Done()) // nil channel（永不关闭）

    // TODO：还没想好用哪个 context 时的占位，语义同 Background
    todo := context.TODO()
    fmt.Println("TODO 等价于 Background:", todo.Err() == nil)

    _ = ctx
    _ = todo
}
```

**规则**：
- `Background()` 是入口——`main`、应用初始化、测试里没有上级 context 时用它。
- `TODO()` 是「应该引入 context 但还没引入」的占位符，语义与 Background 相同，只是写给读者看。
- 这两个都是「永不被取消、无值」的空 context。

### 3.2 `WithCancel`：手动取消

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background()) // 返回子 ctx 与取消函数

    // 一个监听取消的 goroutine
    go func() {
        for {
            select {
            case <-ctx.Done(): // 一旦 cancel() 被调用，这里立即就绪
                fmt.Println("收到取消，清理资源并退出")
                return
            default:
                fmt.Println("工作中……")
                time.Sleep(100 * time.Millisecond)
            }
        }
    }()

    time.Sleep(350 * time.Millisecond)
    cancel() // 手动触发取消：广播给所有依赖此 ctx 的 goroutine
    time.Sleep(50 * time.Millisecond)
    fmt.Println("main 结束")
}
```

**关键**：
- `WithCancel` 返回一对 `(ctx, cancelFunc)`。
- `cancel()` 只能被调用**一次**，第二次调用是无害的（幂等）。调用后 `ctx.Done()` 立即关闭、`ctx.Err()` 变为 `context.Canceled`。
- **必须 `defer cancel()`**，否则 ctx 资源（定时器、goroutine 监听器）泄漏（见坑 2）。

> **C++ 对照**：`cancel()` ≈ `jthread.request_stop()`，但 Go 的取消会**沿树向下传播**——从当前 ctx 派生的所有子 ctx 一起收到 Done。这正是「取消整条调用链」的威力。

### 3.3 `WithTimeout` / `WithDeadline`：自动超时

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    // 3 秒后自动取消（等价于设置一个 3 秒的绝对 deadline）
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel() // 即便提前返回也要 cancel，避免计时器泄漏

    select {
    case <-time.After(5 * time.Second): // 模拟一个 5 秒的慢任务
        fmt.Println("任务做完（没走到这说明已超时）")
    case <-ctx.Done():
        fmt.Println("任务被上下文取消:", ctx.Err()) // context deadline exceeded
    }
}
```

**WithTimeout vs WithDeadline**：
- `WithTimeout(ctx, d)` = 从现在起 `d` 后超时（相对时间）。
- `WithDeadline(ctx, t)` = 到绝对时刻 `t` 超时。
- 内部 WithTimeout 就是 `WithDeadline(now + d)`，二选一即可。

### 3.4 在 goroutine 里用 `ctx.Done()` 清理资源

```go
package main

import (
    "context"
    "fmt"
    "time"
)

// slowOperation 模拟一个可被取消的耗时代码
func slowOperation(ctx context.Context) error {
    // 逐个分片处理，每片都检查是否被取消
    for i := 0; i < 5; i++ {
        select {
        case <-ctx.Done():
            fmt.Println("分片处理中途被取消:", ctx.Err())
            return ctx.Err() // 把取消原因往上抛
        case <-time.After(time.Second): // 模拟处理 1 秒
            fmt.Printf("已处理分片 %d\n", i+1)
        }
    }
    return nil
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    err := slowOperation(ctx)
    fmt.Println("slowOperation 返回 err =", err) // context deadline exceeded
}
```

**这是最核心的 goroutine 收尾模式**：长任务不是「闷头做完」，而是「每步检查 `ctx.Done()`」，真正做到**及时停止、清理资源、向上报告原因**。

### 3.5 取消向子 context 传播（树形传播）

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    parent, parentCancel := context.WithCancel(context.Background())
    child, _ := context.WithCancel(parent) // child 由 parent 派生

    go func() {
        <-child.Done() // 父取消 → 子一起停
        fmt.Println("child 收到取消, Err =", child.Err()) // context canceled
    }()

    go func() {
        <-parent.Done()
        fmt.Println("parent 也收到取消")
    }()

    time.Sleep(100 * time.Millisecond)
    parentCancel() // 取消整个子树
    time.Sleep(100 * time.Millisecond)
}
```

**传播规则**：
- 取消**只能向下**传播：父 cancel → 父 + 所有子 + 孙一起结束。
- **反过来不行**：子 cancel（`child` 自己的 cancelFunc）不会影响父和兄弟。
- 树型结构意味着「顶层 context 掌握整棵树的生死」——比如 HTTP 请求入口 cancel 一下，底下所有 db 查询、外部调用全部停止。

### 3.6 `WithValue`：请求级数据

```go
package main

import (
    "context"
    "fmt"
)

// 用自定义类型做 key，避免和其他包冲突
type traceIDKey struct{}

func WithTraceID(parent context.Context, id string) context.Context {
    return context.WithValue(parent, traceIDKey{}, id)
}

func GetTraceID(ctx context.Context) string {
    if id, ok := ctx.Value(traceIDKey{}).(string); ok {
        return id
    }
    return ""
}

func handler(ctx context.Context) {
    fmt.Println("handler 看到 trace_id:", GetTraceID(ctx))
}

func main() {
    ctx := WithTraceID(context.Background(), "abc-123-xyz")
    handler(ctx) // trace_id 顺着 ctx 一路传下去
}
```

**用 Value 的规矩**：
1. **key 用自定义（不可导出的）类型**，绝不能是普通 `string`——两个包都用 `"id"` 作 key 就会互相踩。
2. **只能存「请求级」数据**：trace id、用户身份、API 版本等「横切关注点」；不该存大数组、不该存对象集合。
3. `Value` 查找是**沿着树的**：先找自己，往上找父。找到即返回；返回值是 `any`，用 type assertion 取。
4. **不建议**用 Value 实现业务逻辑参数（那是函数参数该干的）。

> ⚠️ **C++ 对照**：C++ 没有等价物——`thread_local` 无法跨异步/actor 传播，全局 map 又不可靠。Go 的 `WithValue` 是「跟随调用链、类型安全、可组合」的请求级数据方案。

### 3.7 context 的三大规则

1. **`context.Context` 永远作为函数第一个参数**（惯例）：
   ```go
   func DoSomething(ctx context.Context, x int) error { ... }
   ```
2. **绝不传 `nil` ctx**：不知道用什么就传 `context.TODO()`；测试传 `context.Background()`。
3. **不要把 Context 塞进 struct 字段**：

```go
// ❌ 反模式：Context 进 struct
type Server struct {
    ctx context.Context // 不要！Context 应随调用流走，不是常驻状态
}

// ✅ 正确姿势：方法参数
func (s *Server) Handle(ctx context.Context, req interface{}) {
    // 从 ctx 派生、检查、传递
}
```

原因：Context 是「本次请求的取消 / 超时 / 数据」语境，放进 struct 会让它变成「全局状态」——多协程并发时互相污染。

### 3.8 完整示例：超时 + 取消 + 传值合流（模拟 HTTP 处理）

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type reqIDKey struct{}

// fetchUserData 模拟一个「可能超时的下游调用」
func fetchUserData(ctx context.Context, id string) (string, error) {
    select {
    case <-time.After(500 * time.Millisecond): // 下游通常 300ms 完成
        return fmt.Sprintf("用户 %s 的数据", id), nil
    case <-ctx.Done():
        return "", ctx.Err() // 超时或被取消
    }
}

func handleRequest(ctx context.Context, id string) (string, error) {
    // 给这次请求再加 200ms 的兜底预算 → 总超时 = 父超时与 200ms 谁先谁赢
    childCtx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    defer cancel()

    data, err := fetchUserData(childCtx, id)
    if err != nil {
        return "", fmt.Errorf("fetch 失败: %w", err)
    }
    return data, nil
}

func main() {
    ctx := context.WithValue(context.Background(), reqIDKey{}, "req-0001")

    start := time.Now()
    result, err := handleRequest(ctx, "u-42")
    if err != nil {
        fmt.Printf("耗时 %v, 错误: %v\n", time.Since(start), err)
        return
    }
    fmt.Printf("结果: %s, 耗时 %v\n", result, time.Since(start))
}
```

**组合逻辑**：
- 上层给 200ms 预算，`fetchUserData` 也在盯自己的 ctx；任一先触发取消，另一条路径都会立刻感知。
- 错误用 `%w` 包装保留 cause 链，方便上层判断 `errors.Is(err, context.DeadlineExceeded)`。

### 3.9 标准库中 context 无处不在

你不必自己发明——Go 标准库的 IO / 网络接口几乎都接受 ctx，取消会自动向下游传播：

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "net/http"
    "time"
)

func main() {
    // net/http：带超时的请求
    ctxReq, cancelReq := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancelReq()
    _ = ctxReq // 真正使用时把 ctxReq 传给 NewRequestWithContext
    // req, _ := http.NewRequestWithContext(ctxReq, http.MethodGet, "https://example.com", nil)
    // resp, err := http.DefaultClient.Do(req) // 超时会中止底层连接读

    // database/sql：带超时的查询
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    // rows, err := db.QueryContext(ctx, "SELECT ...") // 超时自动取消

    // 服务器端：每个请求自带 ctx（含截止时间、客户端断开传播）
    _ = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        requestCtx := r.Context() // 客户端断连 / SSE 关闭时 Done 自动触发
        fmt.Printf("Got ctx: %v\n", requestCtx)
    })

    _ = sql.DB{}
    fmt.Println("标准库中 ctx 是跨 IO 取消的标准通道")
}
```

**结论**：你在自己的函数里遵守「ctx 第一参数、选 ctx.Done()` 监听」的约定，就能和所有标准库的无缝对拔——这正是 Go 生态一致性的来源。

---

## 四、常见坑与误区

### 坑 1：忘了调 `cancel()` → 资源泄漏

**现象**：长跑服务内存 / goroutine 数缓慢增长；`WithTimeout` 的底层定时器没释放。
**原因**：`WithCancel/WithTimeout/WithDeadline` 创建的 ctx 若一直不 cancel，其 goroutine / timer 会一直挂着。
**正确写法**：拿到 `cancel` 的**同一作用域**立即 `defer cancel()`，哪怕你根本不会手动取消。

### 坑 2：把 `context` 传给下游后，下游又把取消「吞掉」

**现象**：下游 goroutine 自己的 select 不监听 `ctx.Done()`，取消信号到达后它还在闷头干。
**原因**：ctx 只是被动听的 channel；没人监听它，取消就是空弹。
**正确写法**：**每个**会阻塞的地方都要 `select { case <-ctx.Done(): ... }`（时间.sleep、channel 收发、IO 全都要对应检查）。

### 坑 3：拿没有「取消语义」的 ctx 去覆盖子任务的 deadline

**现象**：`child := context.WithTimeout(ctx, 5s)` 里 `ctx` 是 `Background()`（无 deadline），以为子任务超时了父级会知道——不会。
**原因**：父的 deadline 不因子而改变；propagation 只是「取消」方向向下。
**正确写法**：要「父也设 5s」，就应在**根**上 WithTimeout，或手动把父子两者都设同一个时间。

### 坑 4：用 `WithValue` 存业务对象 / 可变大对象

**现象**：`context.WithValue(ctx, key, hugeSlice)`，并发读共享大切片；或把整个 service 对象塞进 ctx。
**原因**：ctx 数据是「请求级横切」的，不该背业务负载。
**正确写法**：只放小体积、不可变、请求级 key-value（trace id、session 元信息）；复杂数据走参数。

### 坑 5：传 `nil` context

**现象**：C++ 习惯「nullptr 检查」，传进来才发现 `ctx.Done()` panic：`panic: nil channel` 或库内部 nil 解引用。
**原因**：多个标准库 API 对 nil ctx 直接 panic。
**正确写法**：约定「函数第一个参数必须是 ctx」，传 `context.TODO()` / `context.Background()`，vet（`go vet`）会辅助检查。

### 坑 6：把 ctx 存进 struct / 全局变量

**现象**：struct 里存 ctx，多个并发请求共享同一个 handler 实例，取消互相污染；或全局 ctx 迟早被 cancel，所有请求一起完蛋。
**原因**：ctx 语义是「每请求 / 每次调用」，不是长期对象状态。
**正确写法**：方法签名传参（第一条规则），不要把 ctx 保存在对象上。

### 坑 7：对 `ctx.Err()` 的处理不分取消与超时

**现象**：拿到 `err == context.DeadlineExceeded` 和 `context.Canceled` 都当「失败返回 500」，掩盖了「用户主动取消」这种正常情况。
**原因**：没区分两种错误码。
**正确写法**：用 `errors.Is(err, context.Canceled)` / `errors.Is(err, context.DeadlineExceeded)` 分别处理，日志区分；取消不一定是错误。

---

## 五、练习任务

- [ ] 用 `WithCancel` 写「按需优雅退出」的后台任务，主程序 1 秒后 cancel，后台收到 Done 打印清理日志
- [ ] 用 `WithTimeout` 给一个模拟 5 秒的慢任务设置 1 秒超时，观察 err 为 `DeadlineExceeded`
- [ ] 把 C++ 里用 `std::jthread` + `stop_token` 写的「可取消的耗时计算」，改成 Go 版（context 监听 + 分步检查 Done），对比两套取消 API
- [ ] 验证树形传播：父 cancel 后，两个子 context（一个 WithCancel、一个 WithTimeout）的 Done 都触发；再验证子 cancel 不影响父
- [ ] 用 `WithValue` 传递 trace_id，写一个 3 层调用链，每层都打印 trace_id，说明 key 要用自定义类型的原因
- [ ] 复刻坑 1：故意不 cancel 一个 WithTimeout ctx，用 `runtime.NumGoroutine()` 观察 goroutine 数变化，再用 defer cancel 修复
- [ ] 写一个 `fetchUserData` + `handleRequest` 组合示例（类似 3.8），用 `errors.Is` 区分超时与取消

---

## 六、延伸与参考

- [context 包官方文档](https://pkg.go.dev/context)
- [The Go Blog - Contexts and structs](https://go.dev/blog/context-and-structs)（「Context 不进 struct」的官方权威解释）
- [Go by Example - Context](https://gobyexample.com/context)
- 相关笔记：[[03-select多路复用]]、[[07-并发模式-workerpool-扇入扇出-pipeline]]、[[08-数据竞争与race检测]]