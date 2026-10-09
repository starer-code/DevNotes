# Boost.Asio 回调机制初步窥探

> 验证 Boost.Asio 开发环境 + 理解异步回调与 Qt 信号槽的对应关系

## 一、环境验证：异步定时器

Asio 是纯头文件库（Header-Only），不需要 `b2.exe` 编译，配置包含目录后即可 `#include` 使用。

**验证代码**：

```cpp
#include <iostream>
#include <boost/asio.hpp>

int main() {
    boost::asio::io_context io;

    boost::asio::steady_timer timer(io, std::chrono::seconds(3));

    timer.async_wait([](const boost::system::error_code& ec) {
        if (!ec) {
            std::cout << ">>> 3s elapsed, async callback fired" << std::endl;
        }
    });

    std::cout << "--- main thread continues immediately ---" << std::endl;

    io.run();
    return 0;
}
```

**预期输出**（顺序证明异步非阻塞）：

```
--- main thread continues immediately ---
（3 秒间隔）
>>> 3s elapsed, async callback fired
```

**证明了三件事**：

1. 编译通过 → 头文件路径正确，`io_context` / `steady_timer` 类型识别正常
2. 链接通过 → Asio 纯头文件，无需额外 `.lib`
3. 异步执行 → 第二行立即打印、第三行 3 秒后打印，说明 `io.run()` 驱动了事件循环，而非同步阻塞

## 二、回调 vs if 轮询

| 机制 | 模型 | CPU 开销 | 适用场景 |
|---|---|---|---|
| `while + if` | 主动轮询（Polling） | 高（忙等） | 简单条件判断 |
| `async_wait(callback)` | 被动通知（Event-Driven） | 极低（OS 计时，触发才回调） | I/O、定时器、网络 |

回调的本质：把函数交给底层，等系统通知时**主动调用**你注册的函数。避免了死循环轮询。

## 三、与 Qt 信号槽的对应关系

Boost.Asio 的回调和 Qt 的信号槽是**同一事件驱动模型的两层封装**：

| 层 | 写法 | 事件循环 |
|---|---|---|
| Boost.Asio（底层，跨平台无 GUI） | `timer.async_wait([](ec){ ... });` | `io.run()` |
| Qt（上层封装，GUI 友好） | `QTimer::singleShot(3000, this, [](){ ... });` | `QApplication::exec()` |

Qt 的 `connect(timer, &QTimer::timeout, this, &MyClass::onTimeout)` 本质上就是把 `onTimeout` 注册为回调，3 秒后 Qt 事件循环收到系统事件后调用它。**槽函数就是回调函数**。

Asio 不绑 Qt 是为了跨平台（Linux 服务器、嵌入式）。Qt 里用 `QTcpSocket` 时同样基于回调：`connect(socket, &QTcpSocket::readyRead, ...)`。

## 四、Header-Only 与编译为库

| 阶段 | 做法 | 原因 |
|---|---|---|
| 学习/开发 | 直接 `#include <boost/asio.hpp>` | 最短路径跑通，无需 `b2` |
| 生产/部署 | CMake + 编译为 `.lib` / `.dll` / `.so` | 体积可控、编译速度、跨平台分发 |

Asio 把实现写在 `.hpp` 里，编译时随 `main.cpp` 一起编译进 exe。生产环境用 CMake 编译 Boost 底层，避免每次编译都处理几万行头文件。

## 五、后续学习路线

1. **同步 TCP Echo Server**：`tcp::acceptor` + `tcp::socket` + `read/write`，理解 acceptor/socket 生命周期
2. **异步 TCP Echo Server**：`async_accept` / `async_read` / `async_write` + Lambda 回调，处理粘包/拆包
3. **高并发**：`shared_ptr` + `strand` 管理多线程 `io_context.run()`，Reactor 模式
4. **进阶**：C++20 协程 + Asio，用同步写法实现异步服务器

## 六、常见坑

- 预处理器定义 `_WIN32_WINNT=0x0601`，否则 Asio 某些底层 API 编译报错
- Asio 纯头文件库，**不需要** `b2.exe` 编译（除非后续用 `boost.python`、`boost.thread` 等需要链接的库）
- `io.run()` 阻塞在事件循环上，所有回调执行完毕后才返回
