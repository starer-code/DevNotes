# 02 - channel 详解

> C++ 里你得自己造「互斥锁 + 条件变量 + 队列」才能做到的线程通信，Go 用一个 channel 就把它变成了语言级原语

---

## 一、简述

channel（通道）是 Go 并发模型的**核心**，它的口号是：

> **「Do not communicate by sharing memory; instead, share memory by communicating.」** —— 不要通过共享内存来通信，而要通过通信来共享内存。

一个 channel 就是一个**带类型的 FIFO 队列**，goroutine 之间通过它发送 / 接收数据，同时天然完成了**同步**（谁等谁、什么时候等）与**数据传递**两件事。

作为 C++ 开发者，你过去写线程同步大概是这样：`std::mutex` 保护共享数据 + `std::condition_variable` 通知 + `std::queue` 存数据 + 各种 `unique_lock`。而 Go 把这三件套打包成了一个 channel：**发送阻塞、接收阻塞、容量限制、关闭通知**全部内建，而且它在**语言层面**保证了 channel 操作本身的线程安全。

本笔记覆盖：创建、无缓冲 / 有缓冲的阻塞语义、单向 channel、关闭与 `range` 消费、nil channel、死锁场景，以及「channel 当锁」的奇技淫巧。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 消息队列 | `std::queue<T>` + `std::mutex` + `std::condition_variable` | `ch := make(chan T)` | Go 一条语句搞定，且是语言级原语 |
| 无缓冲阻塞队列 | 手写「空/满都等条件变量」的队列 | `make(chan T)`（默认无缓冲） | 无缓冲 channel 天然同步：发=等收 |
| 有缓冲队列 | `std::queue` + 信号量限制 | `make(chan T, 5)` | 缓冲即容量，满则发送阻塞 |
| 发送操作 | `queue.push(x); cv.notify_one();` | `ch <- x` | `<-` 方向右：发送 |
| 接收操作 | `queue.pop();`（空时等 cv） | `x := <-ch` | `<-` 方向左：接收 |
| 队列空时接收 | 条件变量等待 + 谓词循环 | 阻塞直到有值 | Go 不需要手写谓词循环 |
| 队列满时发送 | 信号量 / 容量检查 | 阻塞直到有空位 | 缓冲满才阻塞，缓冲空才阻塞 |
| 生命周期管理 | 队列对象手动析构、小心悬垂 | `close(ch)`，只能发送方关闭 | 关闭后 range 自动结束 |
| 多读多写 | 一把锁 + 一个队列满危险 | 内建线程安全，任意并发收发 | Go 收发都允许并发，无需额外锁 |
| 非阻塞操作 | try_lock / 检查队列非空 | `select + default`（下篇讲） | select 是非阻塞收发的标准姿势 |

---

## 三、逐主题详解

### 3.1 创建 channel：`make`

```go
package main

import "fmt"

func main() {
    // 无缓冲 channel：接收方和发送方必须同时准备好，相当于一次「握手」
    ch1 := make(chan int)

    // 有缓冲 channel：容量为 5，缓冲不满时发送不阻塞
    ch2 := make(chan string, 5)

    // 只声明不 make 的 channel 是 nil channel
    var ch3 chan float64
    fmt.Println(ch3 == nil) // true（nil channel 不能收发，见 3.7）

    fmt.Println(ch1 == nil, ch2 == nil) // false, false
    _ = ch1
    _ = ch2
}
```

> ⚠️ **C++ 对照**：`make(chan int)` 既有「分配」又有「初始化」两层含义，像 `std::make_shared<T>()`。注意这里返回的是 **channel 本身**，不是一个指针——但你如果 `ch2 := make(chan int)` 再 `ch2 = ch2`，传递的都是同一个底层通道的引用，多个 goroutine 共享它时不需要再加锁。

### 3.2 无缓冲 channel：天然同步（先看它为什么会阻塞）

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan string) // 无缓冲

    // 在 main 里启动一个 goroutine，负责发送
    go func() {
        fmt.Println("发送方: 准备发送...")
        ch <- "ping" // 发送会阻塞，直到 main 的接收就绪
        fmt.Println("发送方: 发送完成（对方已收到）")
    }()

    // 给发送方一点时间先跑起来
    time.Sleep(200 * time.Millisecond)

    fmt.Println("主 goroutine: 准备接收...")
    msg := <-ch // 接收会阻塞，直到发送方就绪
    fmt.Println("主 goroutine: 收到", msg)

    // 注意输出顺序：必须发送方和接收方「同时就绪」才能完成一次传递
    // time.Sleep 之后 main 才接收，所以发送方的两行打印会在接收前后交错
    time.Sleep(50 * time.Millisecond)
}
```

**行为解读**：
- 无缓冲 channel 的发送是**同步**的：`ch <- x` 会等待有一个接收者把值取走才返回。
- 无缓冲 channel 的接收也是**同步**的：`<-ch` 会等待有一个发送者送值过来。
- 值在「发送方交出」和「接收方拿到」之间，没有缓冲可暂存。

> **C++ 对照**：等价于「一方 `std::unique_lock` 上锁后 `cv.wait`，另一方 notify，两边同时准备就完成了数据搬运」——但 Go 把配对握手做成了语言级语义，写错（只发不收 / 只收不发）会直接变死锁，见 3.8。

### 3.3 有缓冲 channel：容量就是「积压上限」

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 2) // 缓冲容量 2

    // 容量未满：连续往缓冲里塞，不阻塞
    ch <- 1
    ch <- 2
    fmt.Println("已塞入 2 个，len=", len(ch), "cap=", cap(ch))

    // 容量已满：再发送会阻塞（这里如果直接执行会死锁）
    // ch <- 3 // ❌ 缓冲已满，无接收方 → 永久阻塞 → deadlock

    // 先取走一个，腾出位置
    v := <-ch
    fmt.Println("取走", v, "剩余 len=", len(ch))

    // 现在可以再塞了
    ch <- 3
    fmt.Println("再塞入 3，len=", len(ch))
}
```

**要点**：
- `len(ch)` / `cap(ch)` 只在调试 / 演示时用，生产代码别依赖它们做流程判断——收发本身就是阻塞式的「流量控制」。
- 有缓冲 channel ≈ 「信号量 + 队列」：缓冲未满可以连续发，满了就阻塞，接收腾出空位后继续。

> ⚠️ **C++ 对照**：有缓冲 channel 有点像 `std::deque<T>` + 计数信号量，但并发安全且阻塞语义内建。C++ 里不会有「缓冲满发送阻塞」——你得自己上锁、检查 size、再 wait。

### 3.4 发送 / 接收的阻塞语义总结

| 操作 | 场景 | 行为 |
|------|------|------|
| `ch <- x` | 无缓冲，无接收方在等 | **阻塞**，直到有接收方 |
| `ch <- x` | 有缓冲，缓冲没满 | 立即返回 |
| `ch <- x` | 有缓冲，缓冲已满 | **阻塞**，直到被取走一个 |
| `<-ch` | 无缓冲，无发送方在等 | **阻塞**，直到有发送方 |
| `<-ch` | 有缓冲，缓冲非空 | 立即返回，取走队首 |
| `<-ch` | 有缓冲，缓冲为空 | **阻塞**，直到有值被写入 |
| `v, ok := <-ch` | channel 已关闭 | 立即返回，`ok == false` |

### 3.5 单向 channel：用参数约束「只许发 / 只许收」

`chan<- T` 表示**只写**（只能发送），`<-chan T` 表示**只读**（只能接收）。单向类型本身不能 `make`，它是从双向类型「降级」来的。

```go
package main

import "fmt"

// sendOnly 只能发送数据，不能接收
func sendOnly(ch chan<- int) {
    ch <- 10
    // x := <-ch // ❌ 编译错误：不能在 chan<- 上接收
}

// recvOnly 只能接收数据，不能发送
func recvOnly(ch <-chan int) {
    v := <-ch
    fmt.Println("recvOnly 收到:", v)
    // ch <- 99 // ❌ 编译错误：不能在 <-chan 上发送
}

func main() {
    ch := make(chan int) // 双向 channel

    // 双向 channel 可以隐式转成单向传参，反向不行
    sendOnly(ch)
    recvOnly(ch)
    fmt.Println("完成")
}
```

**为什么要有单向 channel**：它让**接口意图自文档化**。一个函数 `worker(out chan<- Result)` 一眼可知「这个函数只往外发结果」，杜绝函数内部越权接收、破坏整个数据流。这是 Go 最常见的「约束即文档」设计。

### 3.6 关闭 channel 与 `range` 消费

channel 关闭的规则：**只有发送方应该 `close`**，接收方关闭会产生运行时 panic。

```go
package main

import "fmt"

func producer(out chan<- int) {
    // 只发 5 个数，然后关闭
    for i := 1; i <= 5; i++ {
        out <- i * 10
    }
    close(out) // ✅ 发送方关闭，接收方 range 才能正常结束
    fmt.Println("producer 已关闭 channel")
}

func main() {
    ch := make(chan int)
    go producer(ch)

    // range 自动等到 channel 被关闭才退出，逐个消费
    for v := range ch {
        fmt.Println("收到:", v)
    }
    fmt.Println("channel 关闭，循环结束")
}
```

**关闭后的行为**：
- 向**已关闭** channel 发送 → **panic**：`send on closed channel`。
- 从**已关闭** channel 接收 → 立即返回**零值**（不阻塞、不报错）。
- 用 `v, ok := <-ch` 判断：`ok == false` 说明 channel 已关闭且缓冲已取空。

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 42
    close(ch)

    v, ok := <-ch // 缓冲里还有值
    fmt.Println("第一次:", v, ok) // 42 true（缓冲未取空）

    v, ok = <-ch // 缓冲取空了，channel 已关闭
    fmt.Println("第二次:", v, ok)  // 0 false（零值 + 关闭标记）
}
```

> ⚠️ **C++ 对照**：C++ 队列没有「关闭」概念，习惯用 `sentinel`（哨兵值，如 `-1`）或布尔标记。Go 用 `close` 一次性广播，配合 `range` 让消费方代码极其简洁。**千万不要用「往 channel 里发特殊值」来代替 close**。

### 3.7 nil channel 永久阻塞

```go
package main

import "fmt"

func main() {
    var ch chan int // nil channel
    fmt.Println(ch == nil) // true

    select {
    case ch <- 1: // 往 nil channel 发送：永久阻塞
        fmt.Println("发送成功")
    case <-ch: // 从 nil channel 接收：同样永久阻塞
        fmt.Println("接收成功")
    default:
        // 配合 default 才能让程序继续走下去
        fmt.Println("nil channel 收发都会永久阻塞，用 default 逃逸")
    }
}
```

**nil channel 的特性**：收发双向**永久阻塞**。这看着像坑，但在 `select` 里是**特性**——可以通过把一个 case 的 channel 置为 nil 来「禁用」该分支（见下篇 select 笔记的经典用法）。

### 3.8 channel 当互斥锁（容量为 1 的 trick）

一个容量为 1 的 buffered channel，塞进去一个值 = **上锁**；取出来 = **解锁**。发送成功的前提是槽位空着，这天然互斥。

```go
package main

import (
    "fmt"
    "sync"
)

var counter int

func main() {
    lock := make(chan struct{}, 1) // 容量 1 的 channel 当锁
    lock <- struct{}{}             // 先塞入一个令牌 = 初始「已解锁」

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            <-lock               // 取走令牌：拿锁（拿不到就阻塞等）
            counter++            // 临界区：同时只有一个 goroutine 进来
            lock <- struct{}{}   // 还回令牌：放锁
        }()
    }
    wg.Wait()
    fmt.Println("counter =", counter) // 1000，不会因竞争丢更新
}
```

> **C++ 对照**：等价于一个 `std::mutex`，但 Go 社区不推荐这么写同步——`sync.Mutex` 更直白、可读性更好。这个 trick 的真正价值是帮你**理解 channel 阻塞语义**，也解释了为什么缓冲容量是关键变量。

### 3.9 死锁的常见场景

Go 运行时能检测「所有 goroutine 都阻塞了」的**全局死锁**，此时直接 panic：`fatal error: all goroutines are asleep - deadlock!`。

```go
package main

import "fmt"

// ❌ 这段代码会死锁 panic，仅供观察
func main() {
    ch := make(chan int)
    ch <- 1          // 发送阻塞：此刻没有 goroutine 在接收，main 独自永远等下去
    fmt.Println(<-ch)
}
```

常见死锁模式：
1. **只有发送没有接收**（如上）：无缓冲 channel 发了一个没人收的值。
2. **只有接收没有发送**：`<-ch` 等一个永远不存在的发送方。
3. **锁顺序交错**：A 持锁 1 等锁 2，B 持锁 2 等锁 1（channel 也能造成，和 C++ 一样）。
4. **隐式依赖链**：main 等 wg，而 goroutine 又等 main 手里的 channel——等待成环。

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)

    // goroutine 等待接收
    go func() {
        v := <-ch
        fmt.Println("received", v)
    }()

    // main 打算 1 秒后再发——但 goroutine 已经进入阻塞，main 也进入阻塞
    time.Sleep(time.Second)
    // ❌ 如果上面 goroutine 的接收永远没有发送方对应，会全局死锁 panic
    fmt.Println("main 在等 goroutine 完成，但双方都没有对应的收发 -> 死锁")
    _ = ch
}
```

> ⚠️ **C++ 对照**：C++ 线程互相 join / 互相 wait 同样是死锁，且**没有运行时检测**——程序会永远挂起，只能靠 `gdb` / `std::async` 等手段排查。Go 多了一层「全局阻塞检测」，至少**能当场报错**，这是开发期极大的红利。

---

## 四、常见坑与误区

### 坑 1：向已关闭的 channel 发送

**现象**：运行时报 `panic: send on closed channel`。
**原因**：`close` 语义是「不再有数据了」，发送方继续写违背了契约。Go 检测到即 panic（C++ 不会因为队列关闭报错，因为 C++ 队列根本不可关闭）。
**正确写法**：只有确定不会再发送才 `close`；用 `sync.Once` 保护 close 防止重复 close（重复 close 同样 panic）；真要「通知 + 继续发」就用 `sync.Cond` 或换设计。

### 坑 2：接收方 / 普通调用方去 close

**现象**：`panic: close of closed channel`（对已关的再关）或 `panic: close of receive-only channel`（close 一个只读 channel）。
**原因**：`close` 必须由**发送方**执行，且一个 channel 只能 close 一次。
**正确写法**：谁拥有 channel 的「写权限 + 生命周期」谁负责 close；把 channel 以 `chan<-` 传出去，接收方的类型就决定了它根本调不了 `close`（类型系统帮你堵住）。

### 坑 3：以为从关闭的 channel 读会报错

**现象**：`<-ch` 在 channel 关闭后**不报错**，而是返回零值——好几个人读到零值还觉得正常。
**原因**：Go 规定关闭后接收返回零值（且立即返回），这是设计而非疏忽。
**正确写法**：需要区分「真有零值」和「已关闭」时，用两值接收 `v, ok := <-ch`；或者用 `range` 循环消费，闻到关闭就退出。

### 坑 4：channel 忘记 close 导致消费者迟迟不等不到结束

**现象**：`for v := range ch` 的循环永不退出，程序卡住。
**原因**：生产者漏了 `close(ch)`，range 不知道数据流结束了。
**正确写法**：生产者函数结束前 `defer close(ch)`（只对发送方），或确保所有发送路径上最终都会 close。

### 坑 5：无缓冲 channel 上「自说自话」

**现象**：main 里 `ch <- 1` 然后 `fmt.Println(<-ch)`，以为「发完了再收」。
**原因**：无缓冲 channel 的发送在接收方就绪**之前**不会完成，main 自己把自己阻塞死。
**正确写法**：要么先 `go` 一个接收 goroutine，要么改成有缓冲 channel，要么让同一个 goroutine 里走 `select`（下篇）。

### 坑 6：把有缓冲 channel 当「异步无阻塞神器」

**现象**：`ch := make(chan int, 100000)` 以为塞多少都不阻塞。
**原因**：缓冲总有上限，满了照样阻塞；更重要的是**缓冲越大，数据滞后越严重**，退出时可能丢留在缓冲里的数据。
**正确写法**：缓冲容量要按「生产者与消费者吞吐差」认真设计，配合关闭与消费确认，而不是无脑大缓冲。

### 坑 7：零值 / 关闭语义混淆

**现象**：从已关闭 channel 连续 read，拿到一堆 0 当真实数据。
**原因**：没区分「零值数据」与「关闭标志」。
**正确写法**：业务数据里如果 0 是合法值，必须用 `v, ok := <-ch` 或 `range` 判断流结束，别靠零值猜。

---

## 五、练习任务

- [ ] 写一个无缓冲 channel 的「握手」程序：发方打印"准备发送"，收方打印"准备接收"，观察两个打印与数据交换的顺序
- [ ] 用有缓冲 channel（容量 3）实现一个生产者-消费者：生产者产 10 个数，消费者逐个消费，验证「缓冲满时生产者阻塞」
- [ ] 把 C++ 里用 `std::mutex` + `std::condition_variable` + `std::queue` 实现的有界队列，改写成 Go 版（只用 channel），比较代码行数
- [ ] 写一个「多个发送方、一个接收方」的程序：N 个 goroutine 各发若干数据，接收方用 `range` 消费，最后验证所有数据都被收到
- [ ] 练习关 channel 的三种边界：向已关闭发送 panic、从已关闭接收零值、重复 close panic，各写一个会崩溃的示例并注释原因
- [ ] 用容量 1 的 channel 实现互斥锁保护共享计数器（启动 1000 个 goroutine，确认结果为 1000）
- [ ] 故意构造一个「所有 goroutine 全阻塞」的死锁程序，运行观察 `fatal error: all goroutines are asleep` 报告，并用 `sync.WaitGroup` 修复

---

## 六、延伸与参考

- [A Tour of Go - Channels](https://go.dev/tour/concurrency/2)
- [The Go Blog - Share Memory By Communicating](https://go.dev/blog/codeless-share-memory)（Go 并发哲学的官方文章）
- [Go by Example - Channels](https://gobyexample.com/channels)
- 相关笔记：[[01-goroutine]]、[[03-select多路复用]]、[[07-并发模式-workerpool-扇入扇出-pipeline]]、[[08-数据竞争与race检测]]