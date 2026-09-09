# Qt 网络编程学习路线（网络编程零基础视角）

> 适用人群：已掌握 Qt 基础（信号槽、事件循环、QWidget），**网络编程零基础**
> 适用版本：Qt 6.x（Qt 5 大部分通用）
> 更新日期：2026-08-19

## 目录

- [1. 学习定位与目标](#1-学习定位与目标)
- [2. 网络编程零基础必须先懂的 6 个概念](#2-网络编程零基础必须先懂的-6-个概念)
- [3. 阶段一：TCP 编程入门（第 1~2 周）](#3-阶段一tcp-编程入门第-12-周)
- [4. 阶段二：TCP 深入与实战化（第 3~4 周）](#4-阶段二tcp-深入与实战化第-34-周)
- [5. 阶段三：UDP 编程（第 5 周）](#5-阶段三udp-编程第-5-周)
- [6. 阶段四：HTTP 与高层网络（第 6~7 周）](#6-阶段四http-与高层网络第-67-周)
- [7. 阶段五：进阶与安全（第 8 周起）](#7-阶段五进阶与安全第-8-周起)
- [8. 阶段六：实战项目](#8-阶段六实战项目)
- [9. 推荐资源](#9-推荐资源)
- [10. 总结](#10-总结)

---

## 1. 学习定位与目标

> **核心要点**：你的 Qt 基础（信号槽、事件循环、对象树）是**最大的优势**——Qt 把网络编程封装成了"发信号 + 收信号"，你要补的不是 C++ 网络 API，而是**网络协议的基本概念**。

### 1.1 为什么用 Qt 学网络编程

| 优势 | 说明 |
|------|------|
| 异步事件驱动 | 收发数据都靠信号槽触发，不用自己写多线程阻塞 IO |
| 跨平台 | Windows / Linux / Android 同一套代码 |
| 高层封装 | QTcpSocket / QUdpSocket / QNetworkAccessManager 把 socket API 包装成 Qt 风格 |
| 与 GUI 天然结合 | 收发数据直接刷新界面，客户端/服务器程序最容易做出可视化效果 |

### 1.2 和 C++ 原生 socket 的对比

| 原生 C++（Winsock / POSIX） | Qt 封装 |
|------------------------------|---------|
| `socket()` / `bind()` / `listen()` / `accept()` | `QTcpServer::listen()` / `nextPendingConnection()` |
| `connect()` / `send()` / `recv()` | `QTcpSocket::connectToHost()` / `write()` / `readAll()` |
| 阻塞线程等待，需多线程处理 | 信号槽异步通知，事件循环驱动 |
| 手动管理缓冲区、错误码 | `readyRead` 信号 + `readAll()`，`errorString()` |

> 结论：**先学概念，再学 Qt API**。概念（TCP、端口、粘包）是通用的，Qt 只是更友好的实现工具。

---

## 2. 网络编程零基础必须先懂的 6 个概念

> 这一节是"地基"。学 Qt API 之前，先花半天把这些概念弄清楚，后面写代码才不会懵。

### 2.1 IP 地址

- 定位一台**主机**。IPv4 形如 `192.168.1.100`，`127.0.0.1` 是本机回环地址（自己连自己）。
- Qt 中用 `QHostAddress` 表示，`QHostAddress::Any` 表示监听所有网卡。

### 2.2 端口 Port

- 定位主机上的**一个程序**。范围 0~65535，常见如 80（HTTP）、443（HTTPS）、8080（测试常用）。
- `IP + 端口` = 网络世界里一个程序的唯一地址（socket 地址）。
- Qt 代码里端口就是个 `quint16` 数字。

### 2.3 协议 TCP vs UDP

| | TCP | UDP |
|---|-----|-----|
| 连接 | 面向连接，先"握手" | 无连接，直接发 |
| 可靠性 | 可靠、有序、不丢包 | 不可靠，可能丢包乱序 |
| 速度 | 慢一些（要确认重传） | 快 |
| 用途 | 文件传输、聊天、网页 | 视频流、DNS、游戏实时位置 |
| Qt 类 | `QTcpServer` + `QTcpSocket` | `QUdpSocket` |

> 今天学的就是 TCP。记住：**TCP 像打电话（先拨通再说话），UDP 像寄明信片（直接丢邮筒，丢不丢不管）**。

### 2.4 Socket（套接字）

- 操作系统提供的"网络文件"抽象：一端写、另一端读。
- **服务器 socket**（QTcpServer）：只负责等待连接，不传数据。
- **连接 socket**（QTcpSocket）：连接建立后真正传数据的管道。客户端和服务器各持一个，成对出现。

### 2.5 客户端 / 服务器模型

```
┌──────────┐   connectToHost   ┌──────────────┐
│  Client  │ ─────────────────▶│   Server     │
│QTcpSocket│   (IP + 端口)     │ QTcpServer   │
└──────────┘                   │  监听端口     │
                               └──────────────┘
```

- 服务器：`listen()` 监听 → 收到连接 → `nextPendingConnection()` 取客户端 → 收发数据。
- 客户端：`connectToHost(IP, 端口)` → 连接成功 → 收发数据。
- **角色区别**：客户端主动发起连接，服务器被动等待。这是理解所有代码的第一步。

### 2.6 半双工 vs 全双工 / 粘包（先了解，阶段二深挖）

- TCP 是全双工：双方可以同时收发。
- **粘包/拆包**：TCP 是字节流，没有"消息边界"。`readAll()` 读到的可能是一条消息的一半，也可能是两条粘在一起。这是 TCP 编程最经典的坑，阶段二专门解决。

> ✅ **本阶段验收**：能不看资料向别人解释上面 6 个概念，并说出"今天代码里 `connectToHost("127.0.0.1", 8080)` 每个参数在干什么"。

---

## 3. 阶段一：TCP 编程入门（第 1~2 周）

> **核心要点**：本阶段目标是用 QTcpServer / QTcpSocket 跑通"客户端 ↔ 服务器"双向通信。**已完成** ✅（2026-08-19，见《Qt网络编程-01-TCP客户端与服务端.md》）。

### 3.1 环境准备

```pro
QT += network        # .pro 中加 network 模块（GUI 程序还要 core gui widgets）
```

> 不加这行，`#include <QTcpServer>` 会编译报错。

### 3.2 服务器端四步曲（QTcpServer）

```cpp
// 1. 创建服务器对象（注意父对象 this，交给 Qt 对象树管理）
tcpServer = new QTcpServer(this);

// 2. 监听端口
tcpServer->listen(QHostAddress::Any, 8080);

// 3. 有客户端连入时取出来
connect(tcpServer, &QTcpServer::newConnection, this, [this](){
    QTcpSocket* client = tcpServer->nextPendingConnection();
    clients.append(client);   // 多客户端要存进列表

    // 4. 对每个客户端监听数据
    connect(client, &QTcpSocket::readyRead, this, [this, client](){
        QByteArray data = client->readAll();
        // ... 处理数据，write() 回发
    });
});
```

| 成员 | 作用 |
|------|------|
| `listen(addr, port)` | 开始监听，成功返回 true |
| `newConnection` 信号 | 有新客户端连入时发出 |
| `nextPendingConnection()` | 取出**一个**等待中的客户端 socket（要循环调用取多个） |
| `close()` | 停止监听（不影响已建立的连接） |

### 3.3 客户端三步曲（QTcpSocket）

```cpp
// 1. 创建 socket
socket = new QTcpSocket(this);

// 2. 连接服务器（异步！不会立刻成功）
socket->connectToHost("127.0.0.1", 8080);

// 3. 等信号
connect(socket, &QTcpSocket::connected, this, [](){
    // 连接成功才发数据
    socket->write("Hello Server!");
});
connect(socket, &QTcpSocket::readyRead, this, [this](){
    QByteArray data = socket->readAll();   // 收到服务器数据
});
```

| 信号/方法 | 触发时机 |
|-----------|----------|
| `connected` | 与服务器建立连接成功 |
| `readyRead` | 收到数据（读一次不一定读完，粘包阶段二讲） |
| `disconnected` | 连接断开 |
| `errorOccurred` | 出错（如拒绝连接），用 `errorString()` 看原因 |
| `write(data)` | 发送数据（放入发送缓冲区，异步发送） |
| `readAll()` | 一次性读完当前缓冲区所有数据 |
| `state()` | 当前状态，判断是否 `ConnectedState` |

### 3.4 本阶段必做的三个小练习

- [x] ✅ **控制台版**：TcpSocket（客户端）+ Tcpserver（服务器，支持多客户端广播）——已做
- [x] ✅ **GUI 版**：TCP_Client + TCP_Server 两个带界面的程序——已做
- [ ] 连接被拒实验：服务器没启动时客户端点连接，观察 `errorOccurred` / `errorString()` 输出
- [ ] 两个客户端同时连一个服务器，确认服务器能分别收发（体会 `nextPendingConnection` 每次取一个）

> 💡 **关键顿悟**（今天的代码里已经体现）：服务器**一个 QTcpServer 管多个客户端**，每个客户端一个 QTcpSocket；GUI 版只存了一个 socket，所以一次只能服务一个客户端——这是功能限制，不是错误。

---

## 4. 阶段二：TCP 深入与实战化（第 3~4 周）

> **核心要点**：入门跑通只是"能发能收"，本阶段解决**真正写网络程序绕不开的问题**：粘包、断线、并发。

### 4.1 粘包 / 拆包（必学，TCP 第一大坑）

TCP 是**字节流**，没有消息边界。`readyRead` 触发时缓冲区里可能：
- 一条消息没读完整（**拆包**）
- 多条消息连在一起（**粘包**）

**三种解决思路**（从简到繁）：

| 方案 | 做法 | 适用 |
|------|------|------|
| 固定长度 | 每条消息固定 N 字节，不够就补 | 数据长度固定（如传感器帧） |
| 分隔符 | 消息末尾加 `\n` 或特殊字符，按分隔符切 | 文本协议 |
| **长度头**（最常用） | 前 4 字节存长度，后面跟内容：`[4字节长度][数据]` | 通用、可靠 |

```cpp
// 长度头思路示例：先声明一个 QByteArray buffer 做粘包缓冲
connect(socket, &QTcpSocket::readyRead, this, [this](){
    buffer.append(socket->readAll());
    while (buffer.size() >= 4) {
        qint32 len = ...;                    // 从 buffer 前 4 字节解析长度
        if (buffer.size() < 4 + len) break;  // 数据还没齐，等下一次
        QByteArray msg = buffer.mid(4, len); // 取出一条完整消息
        buffer.remove(0, 4 + len);           // 移除已消费部分
        // 处理 msg
    }
});
```

### 4.2 长连接与断线处理

- 服务器端监听每个客户端的 `disconnected`，从列表移除并 `deleteLater()` 释放（今天代码已做 ✅）。
- 客户端重连：`disconnected` 后延时自动 `connectToHost`。
- **心跳机制**：长连接双方每隔几秒互发心跳包，超时没收到就认为对方死了（`QTimer` 实现）。

### 4.3 并发与阻塞

- Qt 网络是异步的，`write()` / `readAll()` 不阻塞界面，**单线程够用**，别急着上多线程。
- 需要耗时处理（如文件传输、解密）时，用 `QThread` / `QtConcurrent` 把**处理逻辑**丢到工作线程，socket 留在主线程。
- 大文件传输要**分块** + 记录进度（`bytesWritten` 信号）。

### 4.4 本阶段小结任务

- [ ] 用"长度头"协议改造今天的聊天程序，发 100 条消息验证不粘包
- [ ] 服务器记录每个客户端的连接/断开日志（时间 + IP + 端口）
- [ ] 客户端加自动重连（QTimer 每 3 秒尝试一次）

---

## 5. 阶段三：UDP 编程（第 5 周）

> **核心要点**：UDP 没有"连接"，一个 QUdpSocket 既是"客户端"也是"服务器"，学完 TCP 再看 UDP 会非常快。

### 5.1 QUdpSocket 基本用法

```cpp
QUdpSocket *udp = new QUdpSocket(this);
udp->bind(9999);                          // 绑定端口 = 监听（相当于服务器）
udp->writeDatagram("hello", QHostAddress("192.168.1.5"), 9998);  // 发数据（相当于客户端）

connect(udp, &QUdpSocket::readyRead, this, [this](){
    QByteArray data;
    QHostAddress sender;
    quint16 senderPort;
    udp->readDatagram(data.data(), data.size(), &sender, &senderPort);
});
```

### 5.2 与 TCP 的思维差异

| TCP | UDP |
|-----|-----|
| 先连接，再收发 | 直接发，无需建立连接 |
| 服务器管多个连接 socket | 一个 socket 收发所有人 |
| 收发可靠有序 | 不保证送达和顺序 |
| 边界是"字节流"，要处理粘包 | 边界是"数据报"，一条 writeDatagram = 一条消息 |

> **典型练习**：UDP 广播聊天室（`QHostAddress::Broadcast` 群发）、局域网设备发现。

---

## 6. 阶段四：HTTP 与高层网络（第 6~7 周）

> **核心要点**：TCP 是传输层，HTTP 是应用层。现在大量程序不直接写 TCP，而是发 HTTP 请求（JSON 接口、上传下载）。

### 6.1 三个核心类

| 类 | 作用 |
|----|------|
| `QNetworkAccessManager` | 总指挥：发请求、收响应 |
| `QNetworkRequest` | 描述一次请求（URL、请求头、方法） |
| `QNetworkReply` | 响应对象（异步返回，有 `finished` 信号） |

```cpp
QNetworkAccessManager *manager = new QNetworkAccessManager(this);
connect(manager, &QNetworkAccessManager::finished, this, [this](QNetworkReply *reply){
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray body = reply->readAll();   // 响应体
    } else {
        qDebug() << "错误:" << reply->errorString();
    }
    reply->deleteLater();
});
manager->get(QNetworkRequest(QUrl("https://api.example.com/data")));
```

### 6.2 必须掌握的

- GET / POST（`post()` 带 body，常配 JSON）
- 解析 JSON：`QJsonDocument::fromJson` + `QJsonObject`
- 下载文件：`reply->downloadProgress(recv, total)` 做进度条
- 请求头：`QNetworkRequest::setHeader` / `setRawHeader`

> **练习**：写一个"天气查询"或"翻译"小程序，调一个免费 HTTP API，解析 JSON 显示到界面上。这一步做完，你的 Qt 网络能力基本覆盖日常需求。

---

## 7. 阶段五：进阶与安全（第 8 周起）

按需学习，不做强制进度：

| 主题 | 说明 |
|------|------|
| WebSocket | 全双工长连接，实时推送（聊天、行情），Qt 用 `QWebSocket` |
| TLS/SSL 加密 | `QSslSocket`、HTTPS 证书校验，防止数据被窃听 |
| 自定义协议设计 | 消息格式（JSON / 长度头 / 版本号）、序列化、粘包+加密组合 |
| 多线程网络架构 | 连接池、工作线程处理耗时任务、线程安全收发 |
| 局域网组播 | `QAbstractSocket::ShareAddress`、组播组加入 |

---

## 8. 阶段六：实战项目

> 学的最终检验是完整项目。按难度递进，边做边把笔记补进本目录。

| 项目 | 巩固点 | 难度 |
|------|--------|------|
| 聊天室（多客户端 + 广播 + 用户列表） | QTcpServer 多连接、协议设计 | ★★ |
| 点对点文件传输（进度条 + 断点续传） | 粘包、分块、bytesWritten | ★★★ |
| HTTP 下载器（多线程 + 断点续传） | QNetworkAccessManager、并发 | ★★★ |
| 远程控制 / 屏幕监控 | TCP + 定时截图 + 压缩传输 | ★★★★ |
| 局域网即时通讯 + 在线状态（UDP 发现 + TCP 通信） | UDP+TCP 组合、心跳 | ★★★★ |

---

## 9. 推荐资源

### 9.1 官方
- [Qt Network 官方文档](https://doc.qt.io/qt-6/qtnetwork-index.html) — 类参考第一优先
- [Qt 官方示例](https://doc.qt.io/qt-6/examples-network.html) — fortuneserver / blockingsocket 等经典示例
- 《C++ GUI Programming with Qt 4》网络章节 — 经典教材（概念不过时）

### 9.2 网络基础（零基础补课）
- 《图解TCP/IP》— 概念通俗，重点看 TCP/UDP 两章
- 《网络是怎样连接的》— 讲一次完整请求的旅程，建立全局画面
- B站搜索"TCP 三次握手 动画" — 视频理解比文字快十倍

### 9.3 实战参考
- 本目录笔记：《Qt网络编程-01-TCP客户端与服务端.md》（今天的学习）
- 抓包工具 Wireshark — 学网络的神器，看数据包"长什么样"
- Postman / curl — 调试 HTTP 接口

---

## 10. 总结

1. **概念先行**：IP、端口、TCP/UDP、socket、C/S 模型——半天搞定，后面全是水到渠成。
2. **Qt 是异步的**：所有网络操作都是"发请求 → 等信号 → 处理数据"，别用阻塞思路写 Qt 网络。
3. **TCP 的核心难点是粘包**：跑通收发很容易，协议设计才是生产级的门槛。
4. **节奏建议**：阶段一已 ✅，接着做阶段二（粘包 + 重连），然后按兴趣选 HTTP 或 UDP，最后用实战项目收尾。

> 本路线是总纲，随着学习推进，会在本目录下按"Qt网络编程-XX-主题.md"补具体笔记（TCP 基础、粘包协议、HTTP 请求、UDP 广播……）。