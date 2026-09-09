# 04 - sync 包（WaitGroup / Mutex / Once）

> C++ 的 std::thread::join、std::mutex、std::once_flag，Go 用 sync 包给了一套轻量且更安全的等价物

---

## 一、简述

`sync` 包是 Go 标准库的**同步原语仓库**，核心成员：

| 类型 | 用途 | C++ 对应 |
|------|------|----------|
| `sync.WaitGroup` | 等一批 goroutine 全部结束 | `std::thread::join`（一次等多个） |
| `sync.Mutex` | 互斥锁 | `std::mutex` |
| `sync.RWMutex` | 读写锁 | `std::shared_mutex` |
| `sync.Once` | 只执行一次（懒加载 / 单例） | `std::once_flag` + `std::call_once` |
| `sync.Map` | 并发安全的 map（特化场景） | 手写 lock + `std::map` / 无直接对应 |
| `sync.Cond` | 条件变量 | `std::condition_variable` |

> **核心要点**：Go 的哲学是「尽量用 channel」，但**同步原语**（锁 / 分组等待 / 只跑一次）仍然有明确位置。与 C++ 的锁相比，Go 的锁**不可拷贝**、有 `defer` 配合的极简用法、内置检测工具，心智负担小得多。本笔记重点讲 WaitGroup、Mutex / RWMutex、Once，并简述 errgroup。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 等待线程结束 | `t.join()`（单个） | `wg := sync.WaitGroup{}; wg.Add(1); defer wg.Done(); wg.Wait()` | WaitGroup 一次等**一批**，Add 要提前 |
| 互斥锁 | `std::mutex m; m.lock(); m.unlock();` | `var mu sync.Mutex; mu.Lock(); defer mu.Unlock()` | Go 惯例用 `defer` 解锁，防漏 |
| 锁唯一性 | lock 传递没意义 | 结构体字段还是值？**拷贝锁 = 复制已锁状态 → 编译常见错** | Go 锁内含 `noCopy`，拷贝会被提示 |
| 只初始化一次 | `std::once_flag` + `std::call_once` | `var once sync.Once; once.Do(func(){...})` | Go 写进一个 `Do`，天然幂等 |
| 读写锁 | `std::shared_mutex`（C++17） | `sync.RWMutex` + `RLock()/RUnlock()` | 读读并发、写写互斥、写独占 |
| 可重入 | `std::recursive_mutex` 才行 | **Mutex 不可重入**，同 goroutine 再锁 = 自锁死 | Go 明确拒绝重入，倒逼更好的设计 |
| 条件变量 | `std::condition_variable` + predicate 循环 | `sync.Cond`（少见）或直接 channel | Go 社区倾向 channel 代替 cond |
| 分组错误传播 | 手写 `std::future` 收集异常 | `errgroup.Group`（`golang.org/x/sync`） | Go 有现成库，等全部且带首个错误 |

---

## 三、逐主题详解

### 3.1 sync.WaitGroup：等一批 goroutine

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func worker(id int, wg *sync.WaitGroup) {
    defer wg.Done() // 结束前把计数器减 1（defer 保证即使中途 panic 也会减，避免死锁）
    fmt.Printf("worker %d 开始\n", id)
    time.Sleep(100 * time.Millisecond) // 模拟干活
    fmt.Printf("worker %d 结束\n", id)
}

func main() {
    var wg sync.WaitGroup

    for i := 1; i <= 3; i++ {
        wg.Add(1) // ⚠️ Add 必须在 go 之前！计数器先 +1
        go worker(i, &wg) // 注意传指针：WaitGroup 内部要改计数
    }

    wg.Wait() // 阻塞直到所有 Done，相当于「等这一批全部 join」
    fmt.Println("所有 worker 都结束了")
}
```

**WaitGroup 规则**：
1. `Add(delta)` 增加计数器，**必须在 `go` 启动前调用**；在 goroutine 内部 `Add`是反模式，会导致 `Wait` 提前返回（见坑 1）。
2. `Done()` 等价 `Add(-1)`，惯例 `defer`。
3. `Wait()` 阻塞直到计数器归零；之后计数器不能再用（`Add` 正值在 Wait 后调用是 **用错**，官方建议别复用）。
4. 必须**传指针**——`sync.WaitGroup` 里锁 / 计数器被多个 goroutine 改，拷贝一份是复制竞态状态。

> **C++ 对照**：`std::thread::join` 等的是**单个且已知**的线程；WaitGroup 等的是「一批已派发出去的 goroutine」。语义上更像 `join_all`（Boost 的 `join_all`），但 Go 不需要持有每个 goroutine 的句柄。

### 3.2 sync.Mutex：互斥锁

```go
package main

import (
    "fmt"
    "sync"
)

var (
    counter int
    mu      sync.Mutex // 保护 counter
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()          // 上锁
            counter++          // 临界区：同时只有一个 goroutine
            mu.Unlock()        // 解锁（或用 defer 更安全）
        }()
    }
    wg.Wait()
    fmt.Println("counter =", counter) // 1000，无丢失
}
```

**`defer mu.Unlock()` 是 Go 惯例**——函数可能提前 return / panic，defer 保证锁一定释放（等价 C++ 的 RAII `std::lock_guard`）。

```go
func incrementSafe() {
    mu.Lock()
    defer mu.Unlock() // 无论发生什么都会解锁
    counter++
}
```

> ⚠️ **C++ 对照**：C++ 有两种风格——RAII（`std::lock_guard`）和手动 unlock；Go 强制建议「手动 Lock + defer Unlock」，因为没有析构函数，你必须自己把解锁挂在 defer 上。**锁的粒度**：临界区要尽量小，把 IO、网络调用移出锁外。

**锁不可拷贝、不可值传递**：

```go
// ❌ 把 Mutex 放进结构体后把这个结构体值复制/传递，等于复制一份锁状态（可能已锁）
// type Counter struct { mu sync.Mutex; n int }
// c2 := c1 // ❌ go vet 会警告：同步原语不该被拷贝

// ✅ 传指针对
```

`sync.Mutex` 内部有一个 `noCopy` 字段，`go vet` 会标记错误。**struct 里放锁就把它当引用类型对待（永远传指针）。**

### 3.3 sync.RWMutex：读写锁

读多写少的场景，让多个读者并发、写者独占。

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Cache struct {
    mu    sync.RWMutex
    store map[string]int
}

func NewCache() *Cache { return &Cache{store: make(map[string]int)} }

func (c *Cache) Get(key string) int {
    c.mu.RLock()         // 读锁：多个读者可同时进入
    defer c.mu.RUnlock()
    return c.store[key]
}

func (c *Cache) Set(key string, v int) {
    c.mu.Lock()          // 写锁：独占，等所有读者离开
    defer c.mu.Unlock()
    c.store[key] = v
}

func main() {
    cache := NewCache()
    cache.Set("a", 1)

    var wg sync.WaitGroup
    // 5 个并发读者
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                _ = cache.Get("a")
                time.Sleep(100 * time.Microsecond)
            }
        }()
    }
    // 1 个写者
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := 0; j < 10; j++ {
            cache.Set("a", j)
        }
    }()

    wg.Wait()
    fmt.Println("最终值:", cache.Get("a"))
}
```

**要点**：
- `RLock/RUnlock` 是**读锁**（shared lock），多个读者并发不阻塞。
- `Lock/Unlock` 是**写锁**（exclusive lock），必须等所有读者和写者退场。
- **写者优先级**：Go 的 RWMutex 写者等待时不阻塞新读者进入？实际上 Go 1.18 前的写者可能被读者饿死；1.18+ 改用「写者优先」调度，阻塞中新增的读者会排队等写者。**别假设细节，读多写少且写端低频才用 RWMutex**；写端高频时 Mutex 反而更简单高效。

### 3.4 sync.Once：只执行一次

单例初始化、懒加载、只跑一次的注册任务。

```go
package main

import (
    "fmt"
    "sync"
)

var (
    once sync.Once
    config map[string]string
)

func loadConfig() {
    fmt.Println("开始加载配置……（只应执行一次）")
    // 模拟读文件 / 网络
    config = map[string]string{"host": "localhost", "port": "8080"}
    fmt.Println("配置加载完成")
}

func GetConfig() map[string]string {
    once.Do(loadConfig) // 无论多少个 goroutine 调用，Do 只真正执行一次
    return config
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = GetConfig() // 10 个 goroutine 并发调用，只有 1 次真的执行加载
        }()
    }
    wg.Wait()
    fmt.Println("配置:", GetConfig())
}
```

**sync.Once 语义**：
- `once.Do(f)` 保证 `f` 恰好执行**一次**；并发请求者都会**阻塞等到第一次执行完**，之后立即返回。
- 即使 `f` 内部 panic，Once 也认为「已执行」（后续调用不再执行）——这是个隐藏坑。
- 适合：**单例、懒加载、初始化全局资源、只注册一次事件处理器**。

**Go 1.21+ 便捷变体**：`sync.OnceValue[T]` 和 `sync.OnceFunc` / `sync.OnceValues`，直接返回结果值：

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    heavy := sync.OnceValue(func() string { // 返回值的 Once
        fmt.Println("只执行一次的昂贵计算")
        return "hello once"
    })

    for i := 0; i < 3; i++ {
        fmt.Println(heavy()) // 多次调用，内部计算只跑一次
    }
}
```

> **C++ 对照**：`sync.Once` ≡ `std::once_flag + std::call_once`。区别在于 Go 把「标志 + 调用」打包成一个对象，用起来更不易错；C++ 还容易忘掉把 `once_flag` 传递到对的地方。

### 3.5 sync.Map（了解即可）

`sync.Map` 是并发安全的特化 map，**只在特定场景优于「Mutex + 普通 map」**：
- 键值对写入一次、读取非常频繁；
- 不同 goroutine 读写不同的键（无写写冲突）。

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var m sync.Map

    m.Store("a", 1)          // 写
    v, ok := m.Load("a")     // 读
    fmt.Println(v, ok)       // 1 true

    m.LoadOrStore("b", 2)    // 没有才存，返回现有值
    fmt.Println(m.Load("b")) // 2 true

    m.Range(func(k, v any) bool { // 遍历
        fmt.Printf("%v=%v\n", k, v)
        return true // 返回 false 可提前终止
    })
}
```

**注意事项**：它没有 `len()`、`Clear`（Go 1.23 有 `Clear`）、类型不安全（存进去的是 `any`）。一般场景**优先普通 map + Mutex**，`sync.Map` 是性能调优工具，别默认使用。

### 3.6 errgroup：WaitGroup 的错误版（`golang.org/x/sync/errgroup`）

```go
package main

import (
    "errors"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

func main() {
    var g errgroup.Group

    // 三个并发任务，其中一个会失败
    for i := 1; i <= 3; i++ {
        i := i
        g.Go(func() error {
            time.Sleep(time.Duration(i) * 50 * time.Millisecond)
            if i == 2 {
                return errors.New("任务 2 失败了")
            }
            return nil
        })
    }

    err := g.Wait() // 等全部结束，返回第一个非 nil 错误（取消其他任务的语义需配合 context）
    fmt.Println("err =", err)
}
```

`errgroup.Group` = **WaitGroup + 首个错误收集 + （可选）context 取消**。得益于 `g.Go(func() error {...})` 的签名，它写起来比 WaitGroup 还简洁。安装：`go get golang.org/x/sync`。

---

## 四、常见坑与误区

### 坑 1：`Add` 放在 `go` 内部 → `Wait` 提前通过

**现象**：`Wait()` 早早返回，任务没跑完，结果 / 断言失败且时好时坏。
**原因**：`Add` 没赶在 `Wait` 检查之前执行：goroutine 里的 Add 还没跑，`Wait` 看到计数 0 直接放行。
**正确写法**：`wg.Add(1)` 写在启动 goroutine 的**同一个循环体里、`go` 语句之前**；对动态派发数量，先数清楚再 `Add(n)`。

### 坑 2：把 WaitGroup / Mutex 按值拷贝（混着用 struct 值传递）

**现象**：`go vet` 报错或「包着锁的 struct 被复制后，两个副本互相之间不互斥」。
**原因**：`sync.WaitGroup` 和 `sync.Mutex` 内部是状态机 + `noCopy` 标记；拷贝会把「信号量 / 锁状态」一起复制，破坏互斥性。
**正确写法**：所有持锁 / 持 WaitGroup 的对象**传指针**；给 struct 加 `sync.Mutex` 字段时，该 struct 一律指针传递。

### 坑 3：Mutex 不可重入——「自己锁自己」

**现象**：`mu.Lock(); mu.Lock();`（比如递归函数第一行就加锁）→ 永久死锁。
**原因**：`sync.Mutex` **不是**可重入锁；同一个 goroutine 二次 Lock 也会自己把自己堵死（C++ 有 `std::recursive_mutex`，Go 故意不给）。
**正确写法**：把公共逻辑抽成「不加锁的内部函数」+「加锁的对外函数」，由外层统一加锁，避免递归里重复 Lock。

### 坑 4：`sync.Once` 里 panic 后「后门关闭」

**现象**：`once.Do` 里刚 panic，后续 `once.Do` 调用**再不执行**，初始化永远失败但程序继续跑。
**原因**：Once 的设计就是「f 被调用过 = 完成」，panic 也算「调用过」。
**正确写法**：Once.f 内部用 `defer recover` 兜住，把真正会出问题的逻辑包在不会 panic 的薄壳里；或者在 panic 时让整个程序退出重启（服务病态初始化不该继续）。

### 坑 5：锁粒度太大 / 在锁内做阻塞调用

**现象**：临界区里有网络请求 / 大计算，并发能力崩塌甚至互相踩踏。
**原因**：C++ 也常见——锁的作用域过大。
**正确写法**：先拷贝出需要的数据再释放锁，IO 放锁外；能用原子操作 / channel 传值替代共享状态的场景优先替换（配合 `[[05-atomic原子操作]]`）。

### 坑 6：RWMutex 的读锁里不小心又要求写锁

**现象**：持有 `RLock` 的函数内部去调 `Lock` → 死锁（读者变成写者，等自己释放读锁）。
**原因**：读写锁不允许在持读锁时升级为写锁（Go 会死锁或 panic）。
**正确写法**：能拆成两个方法（读方法 / 写方法）就拆开，或统一回到互斥锁。

### 坑 7：WaitGroup 计数归零后再次 Add

**现象**：`Wait()` 已返回后再 `Add(1)` — 官方不保证，可能 panic：`WaitGroup is reused before previous Wait has returned`。
**原因**：WaitGroup 设计为「一次使用」，复用语义不明确。
**正确写法**：每个批次新建一个 WaitGroup，或复用前确保上一批全部 `Wait` 完成且不再 Add。

---

## 五、练习任务

- [ ] 用 WaitGroup 启动 100 个 goroutine 同时打印自己的编号，`Wait()` 后主程序再打印"全部完成"
- [ ] 用 Mutex 保护一个计数器，开 1000 个 goroutine 各自增一次，验证结果恰好 1000
- [ ] 把 C++ 里用 `std::mutex` + `std::condition_variable` 写的「生产者-消费者队列」，先用 Go 的 Mutex + channel 重写，再只用 channel 重写，对比两种风格
- [ ] 用 RWMutex 实现一个并发安全缓存：读者并发读取，写者独占更新，跑 100 个读者 + 几个写者
- [ ] 用 `sync.Once` 实现单例日志器：10 个 goroutine 并发调用，确认初始化日志只打印一次
- [ ] 复现坑 1（Add 放 goroutine 内）并修复，用 sleep 制造时间窗观察 Wait 提前返回
- [ ] （进阶）用 `golang.org/x/sync/errgroup` 并行抓取 3 个「URL 列表」，失败时收集首个错误返回

---

## 六、延伸与参考

- [sync 包官方文档](https://pkg.go.dev/sync)
- [Go by Example - WaitGroup](https://gobyexample.com/waitgroups)、[Go by Example - Mutexes](https://gobyexample.com/mutexes)
- [errgroup（golang.org/x/sync）](https://pkg.go.dev/golang.org/x/sync/errgroup)
- 相关笔记：[[01-goroutine]]、[[02-channel详解]]、[[05-atomic原子操作]]、[[07-并发模式-workerpool-扇入扇出-pipeline]]