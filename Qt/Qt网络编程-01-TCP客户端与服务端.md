# Qt 网络编程 01：TCP 客户端与服务端（第一天）

> 适用版本：Qt 6.9 / MinGW / C++17
> 更新日期：2026-08-19
> 源码位置：`D:\projects\Myqt\net`（TcpSocket / Tcpserver / TCP_Client / TCP_Server 四个项目）

## 目录

- [一、今天做了什么](#一今天做了什么)
- [二、项目清单与角色分工](#二项目清单与角色分工)
- [三、准备工作：.pro 加 network 模块](#三准备工作pro-加-network-模块)
- [四、控制台版：客户端 TcpSocket](#四控制台版客户端-tcpsocket)
- [五、控制台版：服务器 Tcpserver（多客户端广播）](#五控制台版服务器-tcpserver多客户端广播)
- [六、GUI 版：TCP_Client](#六-gui-版tcp_client)
- [七、GUI 版：TCP_Server](#七-gui-版tcp_server)
- [八、核心知识点总结](#八核心知识点总结)
- [九、今天踩的坑 / 值得注意的点](#九今天踩的坑--值得注意的点)
- [十、进阶写法：多客户端封装 ClientConnection 模式](#十进阶写法多客户端封装-clientconnection-模式)
- [十一、明天可以做什么](#十一明天可以做什么)

---

## 一、今天做了什么

用 Qt 实现了 **TCP 客户端 / 服务器** 双向通信，共 4 个项目：

| 项目 | 类型 | 角色 | 特点 |
|------|------|------|------|
| `TcpSocket` | 控制台（QCoreApplication） | 客户端 | 连接即自动发一条 "Hello Server!" |
| `Tcpserver` | 控制台（QCoreApplication） | 服务器 | 多客户端 + 广播 |
| `TCP_Client` | GUI（QWidget） | 客户端 | 界面输入 IP/端口，收发消息 |
| `TCP_Server` | GUI（QWidget） | 服务器 | 界面选择端口，收发消息 |

> 我已有 Qt 基础，但**网络编程是零基础**。今天的关键收获是建立了"客户端/服务器"模型和 Qt 异步收发的心智模型。

---

## 二、项目清单与角色分工

```
┌──────────────┐  connectToHost(127.0.0.1:8080)  ┌──────────────┐
│  客户端        │ ──────────────────────────────▶ │  服务器        │
│ QTcpSocket    │                                │ QTcpServer   │
│ (主动发起连接)  │ ◀────────────────────────────── │ (监听,被动等待) │
└──────────────┘          TCP 全双工双向收发       └──────────────┘
```

| 角色 | Qt 类 | 核心动作 |
|------|-------|----------|
| 客户端 | `QTcpSocket` | `connectToHost(IP, 端口)` 主动连接 |
| 服务器 | `QTcpServer` | `listen(地址, 端口)` 监听；`nextPendingConnection()` 取客户端 |
| 数据传输 | `QTcpSocket`（双方各持一个） | `write()` 发，`readyRead` 信号触发后 `readAll()` 收 |

---

## 三、准备工作：.pro 加 network 模块

```pro
# 控制台版只需要 network
QT += network

# GUI 版还需要 core gui widgets
QT += core gui network
greaterThan(QT_MAJOR_VERSION, 4): QT += widgets
```

> ⚠️ 不加 `QT += network`，`#include <QTcpServer>` 会直接编译失败。

---

## 四、控制台版：客户端 TcpSocket

> 核心演示：**异步连接** + **连接成功后发消息** + **收到数据回调**。

```cpp
// TcpSocket.h
#include <QObject>
#include <QTcpServer>
#include <QTcpSocket>

class TcpSocket : public QObject
{
    Q_OBJECT
public:
    explicit TcpSocket(QObject *parent = nullptr);
private:
    QTcpSocket *socket;
};
```

```cpp
// TcpSocket.cpp
#include "TcpSocket.h"
#include <QDebug>

TcpSocket::TcpSocket(QObject *parent)
    : QObject{parent}
{
    // 1. 创建 socket 对象
    socket = new QTcpSocket(this);

    // 2. 连接服务器（异步！调用后立刻返回，不一定已连接）
    socket->connectToHost("127.0.0.1", 8080);

    // 3. 连接成功时触发
    connect(socket, &QTcpSocket::connected, this, [this](){
        qDebug() << "连接服务器成功";
        // 连接成功后主动发一条消息
        socket->write("Hello Server!");
    });

    // 4. 收到数据时触发
    connect(socket, &QTcpSocket::readyRead, this, [this](){
        QByteArray data = socket->readAll();
        qDebug() << "收到服务器:" << data;
    });
}
```

```cpp
// main.cpp
#include <QCoreApplication>
#include <TcpSocket.h>

int main(int argc, char *argv[])
{
    QCoreApplication a(argc, argv);
    TcpSocket socket;          // 对象必须存活，信号槽才有效
    return QCoreApplication::exec();   // 进入事件循环，等信号
}
```

**运行结果**（先启动服务器，再运行客户端）：

```
连接服务器成功
收到服务器: Hello Server!
```

> 💡 **要点**：`connectToHost` 是**异步**的，调用后立刻返回，连接成功与否由 `connected` / `errorOccurred` 信号告知。这就是 Qt 网络和"写个循环等数据"的阻塞式代码的根本区别。

---

## 五、控制台版：服务器 Tcpserver（多客户端广播）

> 核心演示：**一个 QTcpServer 管多个客户端** + **广播**（收到谁的数据就转发给所有人）。

```cpp
// TcpServer.h
#include <QObject>
#include <QTcpServer>
#include <QTcpSocket>
#include <QList>

class TcpServer : public QObject
{
    Q_OBJECT
public:
    explicit TcpServer(QObject *parent = nullptr);
private:
    QTcpServer * server = nullptr;
    QList<QTcpSocket*> clients;   // 所有已连接客户端的列表
};
```

```cpp
// TcpServer.cpp
#include "TcpServer.h"
#include <QDebug>

TcpServer::TcpServer(QObject *parent)
    : QObject{parent}
{
    // 1. 创建服务器对象
    server = new QTcpServer(this);

    // 2. 监听端口 8080
    server->listen(QHostAddress::Any, 8080);
    qDebug() << "服务器启动，监听 8080 端口";

    // 3. 有客户端连接时触发
    connect(server, &QTcpServer::newConnection, this, [this](){
        // 4. 获取客户端 socket，并存入列表
        QTcpSocket* client = server->nextPendingConnection();
        clients.append(client);
        qDebug() << "客户端已连接，当前连接数:" << clients.size();

        // 5. 监听客户端发来的数据
        connect(client, &QTcpSocket::readyRead, this, [this, client](){
            QByteArray data = client->readAll();
            qDebug() << "收到客户端:" << data;

            // 6. 广播给所有客户端
            for (auto s : clients) {
                s->write(data);
            }
        });

        // 7. 客户端断开时，从列表移除并释放
        connect(client, &QTcpSocket::disconnected, this, [this, client](){
            qDebug() << "客户端已断开，当前连接数:" << clients.size() - 1;
            clients.removeOne(client);
            client->deleteLater();    // 安全释放（等当前事件循环处理完）
        });
    });
}
```

**运行流程**：

```
服务器启动，监听 8080 端口
客户端已连接，当前连接数: 1
收到客户端: "Hello Server!"
```

> 💡 **要点**：
> - `newConnection` 每来一个客户端触发一次，`nextPendingConnection()` 取出**那一个**客户端 socket，存进 `QList` 才能管多个。
> - 每个客户端都要单独 `connect` 它的 `readyRead` 和 `disconnected`。
> - 断开后用 `deleteLater()` 而不是 `delete`，避免在信号回调里直接删对象导致崩溃。
> - `listen(QHostAddress::Any, 8080)` 监听所有网卡——本机、局域网都能连。

---

## 六、GUI 版：TCP_Client

> 核心演示：界面化客户端，`connected / disconnected / errorOccurred` 三个信号的完整处理。

```cpp
// widget.h（节选）
#include <QWidget>
#include <QTcpServer>
#include <QTcpSocket>

class Widget : public QWidget
{
    Q_OBJECT
public:
    Widget(QWidget *parent = nullptr);
    ~Widget();

private:
    Ui::Widget *ui;
    QTcpSocket *tcpSocket;

private slots:
    void connected_Slot();
    void disconnected_Slot();
    void error_Slot(QAbstractSocket::SocketError);
    void readyRead_Slot();
    void on_openBt_clicked();
    void on_closeBt_clicked();
    void on_sendBt_clicked();
};
```

```cpp
// widget.cpp（节选）
Widget::Widget(QWidget *parent)
    : QWidget(parent), ui(new Ui::Widget)
{
    ui->setupUi(this);
    setWindowTitle("Client");

    tcpSocket = new QTcpSocket(this);

    connect(tcpSocket, SIGNAL(connected()), this, SLOT(connected_Slot()));
    connect(tcpSocket, SIGNAL(disconnected()), this, SLOT(disconnected_Slot()));
    connect(tcpSocket, SIGNAL(errorOccurred(QAbstractSocket::SocketError)),
            this, SLOT(error_Slot(QAbstractSocket::SocketError)));
}

void Widget::connected_Slot()
{
    ui->recvEdit->appendPlainText("已连接服务器");
    connect(tcpSocket, SIGNAL(readyRead()), this, SLOT(readyRead_Slot()));
}

void Widget::disconnected_Slot()
{
    ui->recvEdit->appendPlainText("已断开连接");
}

void Widget::error_Slot(QAbstractSocket::SocketError)
{
    ui->recvEdit->appendPlainText("连接失败: " + tcpSocket->errorString());
}

void Widget::readyRead_Slot()
{
    ui->recvEdit->appendPlainText(tcpSocket->readAll());
}

void Widget::on_openBt_clicked()
{
    tcpSocket->connectToHost(ui->IPEdit->text(), ui->portEdit->text().toUInt());
}

void Widget::on_closeBt_clicked()
{
    tcpSocket->close();
}

void Widget::on_sendBt_clicked()
{
    if (tcpSocket->state() != QAbstractSocket::ConnectedState) {
        ui->recvEdit->appendPlainText("错误：未连接服务器");
        return;
    }
    tcpSocket->write(ui->sendEdit->text().toUtf8());
    ui->sendEdit->clear();
}
```

**关键点**：

| 写法 | 说明 |
|------|------|
| `SIGNAL(...)` / `SLOT(...)` 宏 | 老式写法，Qt5 前的主流；类型不匹配**编译期不报错**，运行期静默失效 |
| `&类::信号` / `&类::槽` | 新式写法（Qt5+），编译期检查，推荐；今天控制台版就是这种 |
| `errorOccurred(QAbstractSocket::SocketError)` | 参数类型必须与信号声明**逐字一致**，这是老式写法的坑 |
| `state() != QAbstractSocket::ConnectedState` | 发送前检查连接状态，防止没连上就发数据 |

> 💡 **今天新学到的信号**：`errorOccurred`（Qt 5.15+，替代已废弃的 `error` 信号），连接被拒绝时触发，用 `errorString()` 拿到可读的错误描述。

---

## 七、GUI 版：TCP_Server

> 核心演示：GUI 服务器，用 `listen` + `newConnection` + `readyRead` 完成收发。**注意：这个版本只存了一个 tcpSocket，一次只能服务一个客户端。**

```cpp
// widget.cpp（节选）
Widget::Widget(QWidget *parent)
    : QWidget(parent), ui(new Ui::Widget)
{
    ui->setupUi(this);
    setWindowTitle("Server");

    tcpServer = new QTcpServer(this);
    tcpSocket = new QTcpSocket(this);

    connect(tcpServer, SIGNAL(newConnection()), this, SLOT(newConnection_Slot()));
}

void Widget::newConnection_Slot()
{
    tcpSocket = tcpServer->nextPendingConnection();
    connect(tcpSocket, SIGNAL(readyRead()), this, SLOT(readyRead_Slot()));
}

void Widget::readyRead_Slot()
{
    QString buf;
    buf = tcpSocket->readAll();
    ui->recvEdit->appendPlainText(buf);
}

void Widget::on_openBt_clicked()
{
    tcpServer->listen(QHostAddress::Any, ui->portEdit->text().toUInt());
}

void Widget::on_closeBt_clicked()
{
    tcpServer->close();      // 停止监听
}

void Widget::on_sendBt_clicked()
{
    if (!tcpSocket || tcpSocket->state() != QAbstractSocket::ConnectedState) {
        ui->recvEdit->appendPlainText("错误：没有客户端连接");
        return;
    }
    tcpSocket->write(ui->sendEdit->text().toUtf8());
    ui->sendEdit->clear();
}
```

**与 Tcpserver 控制台版的差异**：

| 对比项 | 控制台版 Tcpserver | GUI 版 TCP_Server |
|--------|-------------------|-------------------|
| 客户端存储 | `QList<QTcpSocket*> clients`（多个） | 单个 `tcpSocket` 成员（一个） |
| 端口来源 | 硬编码 8080 | 界面输入 `ui->portEdit->text().toUInt()` |
| 监听地址 | `QHostAddress::Any` | 相同 |
| 数据回显 | 广播给所有客户端 | 只回给当前这一个客户端 |
| 断线处理 | `disconnected` → 移除 + deleteLater | 无（有改进空间） |

> ⚠️ **值得注意**：GUI 版 `nextPendingConnection()` 返回的新客户端会**覆盖**旧的 `tcpSocket`，旧的连接对象失去引用但没释放（内存泄漏隐患），且新客户端连入后旧客户端收不到数据。改进方案就是控制台版的做法——用列表存 + `disconnected` 时清理。

---

## 八、核心知识点总结

### 8.1 类与职责

| 类 | 职责 |
|----|------|
| `QTcpServer` | 服务器：监听端口、接受连接（**本身不传数据**） |
| `QTcpSocket` | 传输管道：客户端用它连服务器；服务器用它和每个客户端通信 |

### 8.2 服务器完整生命周期

```
new QTcpServer ──▶ listen(地址, 端口) ──▶ 等 newConnection 信号
                                               │
                                               ▼
                              nextPendingConnection() 拿到客户端
                                               │
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                   readyRead: 收数据      write(): 发数据      disconnected: 清理
```

### 8.3 客户端完整生命周期

```
new QTcpSocket ──▶ connectToHost(IP, 端口)
                        │
            ┌───────────┼────────────┐
            ▼           ▼            ▼
       connected    readyRead    errorOccurred
       (连上了)      (收数据)      (连不上)
            │
            ▼
       write(): 发数据      close(): 主动断开 → disconnected
```

### 8.4 高频信号速查表

| 信号 | 谁发出 | 含义 |
|------|--------|------|
| `newConnection` | QTcpServer | 有新客户端连入 |
| `connected` | QTcpSocket | 客户端连上服务器 |
| `readyRead` | QTcpSocket（双方） | 收到数据，可读 |
| `disconnected` | QTcpSocket（双方） | 连接断开 |
| `errorOccurred` | QTcpSocket | 出错（连不上、被重置等） |
| `bytesWritten` | QTcpSocket | 数据发送了一部分（大文件传输用） |

### 8.5 方法速查表

| 方法 | 所属 | 作用 |
|------|------|------|
| `listen(addr, port)` | QTcpServer | 开始监听，返回 bool |
| `nextPendingConnection()` | QTcpServer | 取出一个等待的客户端 socket |
| `close()` | 两者 | 服务器停止监听 / 客户端断开 |
| `connectToHost(ip, port)` | QTcpSocket | 异步连接服务器 |
| `write(data)` | QTcpSocket | 发送数据（进缓冲区，异步） |
| `readAll()` | QTcpSocket | 读取当前缓冲区全部数据 |
| `state()` | QTcpSocket | 连接状态（`UnconnectedState` / `ConnectedState` 等） |
| `errorString()` | QTcpSocket | 人类可读的错误描述 |
| `deleteLater()` | QObject | 延迟安全释放（断开清理时用） |

---

## 九、今天踩的坑 / 值得注意的点

1. **.pro 忘加 `QT += network`** → 编译报错找不到头文件。
2. **`connectToHost` 后立刻 `write`** → 会失败（还没连上）。必须在 `connected` 信号里写，或发送前检查 `state() == ConnectedState`。
3. **老式 `SIGNAL/SLOT` 宏写错参数类型不报错** → 槽永远不触发。今天 `errorOccurred(QAbstractSocket::SocketError)` 的参数必须和信号声明逐字一致。建议新代码用新式 `&` 语法。
4. **GUI 版服务器只有一个 tcpSocket** → 新客户端覆盖旧客户端。多客户端必须用 `QList` 存 + 逐客户端 connect（控制台版已示范）。
5. **中文乱码问题**：发送用 `toUtf8()` 编码，界面直接显示 `readAll()` 返回的 UTF-8 字节一般没问题；跨平台更要注意编码统一。
6. **先启动服务器，再启动客户端**，否则客户端连接被拒（触发 errorOccurred，不是崩溃）。

---

## 十、进阶写法：多客户端封装 ClientConnection 模式

> **为什么有这种写法**：第五节的嵌套 connect 是入门必经之路，但每个客户端的逻辑（收数据、解析、断线清理）全堆在 `newConnection` 的 lambda 里，客户端一多就难维护。生产环境的标准做法是**每个客户端一个类**，把逻辑收拢进自己的类里。

### 10.1 为什么必须拿到 socket 就立刻监听（回答嵌套 connect 的疑问）

`nextPendingConnection()` 每次返回一个**全新的 `QTcpSocket` 对象**，而这个对象只有在这个回调里才拿得到。所以：

1. **不能把 connect 拖到外面**：socket 是回调里现造的，没有其他途径获取"刚才连进来的那个客户端"。
2. **每个客户端都是独立对象**，各有独立的 `readyRead` / `disconnected`，必须对它自己 connect，lambda 里捕获 `client` 就是为了把信号绑定到具体那一个 socket。
3. 嵌套不是"等一个连完再连下一个"（实际是异步并发，多个客户端同时连也没问题），而是"**拿到新 socket → 立刻给它装好监听器**"这个动作只能发生在 `newConnection` 回调里。

### 10.2 ClientConnection 类的完整示例

```cpp
// ClientConnection.h —— 每个客户端一个对象
#ifndef CLIENTCONNECTION_H
#define CLIENTCONNECTION_H

#include <QObject>
#include <QTcpSocket>

class ClientConnection : public QObject
{
    Q_OBJECT
public:
    explicit ClientConnection(QTcpSocket *sock, QObject *parent = nullptr)
        : QObject(parent), m_socket(sock)
    {
        sock->setParent(this);   // 交给对象树管理，断开时随本对象一起销毁

        // 构造函数里就装好监听，拿到 socket 即生效
        connect(sock, &QTcpSocket::readyRead, this, [this](){
            QByteArray data = m_socket->readAll();
            handleData(data);
        });

        connect(sock, &QTcpSocket::disconnected, this, [this](){
            emit disconnected(this);   // 通知服务器把我从列表移除
        });
    }

    void send(const QByteArray &data) { m_socket->write(data); }
    QString peerAddress() const { return m_socket->peerAddress().toString(); }

signals:
    void disconnected(ClientConnection*);   // 携带自身指针，方便服务器删除

private:
    void handleData(const QByteArray &data)
    {
        // 业务逻辑：解析协议、处理消息……（阶段二学粘包后再完善）
    }

    QTcpSocket *m_socket;
};

#endif // CLIENTCONNECTION_H
```

```cpp
// Server.cpp —— 服务器只用管"连接与列表"
#include "ClientConnection.h"
#include <QList>

class Server : public QObject
{
    Q_OBJECT
public:
    explicit Server(QObject *parent = nullptr)
        : QObject(parent)
    {
        m_server = new QTcpServer(this);
        m_server->listen(QHostAddress::Any, 8080);

        connect(m_server, &QTcpServer::newConnection, this, [this](){
            QTcpSocket *sock = m_server->nextPendingConnection();
            ClientConnection *conn = new ClientConnection(sock, this);
            m_conns.append(conn);   // 列表只管对象本身，不管内部 socket

            connect(conn, &ClientConnection::disconnected, this, [this](ClientConnection *c){
                m_conns.removeOne(c);
                c->deleteLater();
            });
        });
    }

private:
    QTcpServer *m_server;
    QList<ClientConnection*> m_conns;   // 存的是连接对象，不是裸 socket
};

```

### 10.3 三种写法的演进对比

| 写法 | 客户端存储 | 业务逻辑位置 | 适用 |
|------|-----------|--------------|------|
| GUI 版 TCP_Server | 单个 socket（会覆盖） | 全在 Widget 槽里 | 演示单客户端 |
| 控制台版 Tcpserver | `QList<QTcpSocket*>` + 嵌套 connect | 全在 newConnection lambda 里 | 学习多客户端思想 |
| **ClientConnection 模式** | `QList<ClientConnection*>` | 每个客户端自己的类里 | **生产/实战项目** |

> 💡 第三种的本质没有变：`nextPendingConnection()` 拿到新 socket → 立刻 connect。只是把"对 socket 的监听"挪进了类的构造函数，服务器代码更清爽，后续加心跳、协议解析、发送队列都在类里扩展，互不干扰。

---

## 十一、明天可以做什么

- [ ] 把 GUI 版 TCP_Server 改成多客户端版（参考控制台版：QList + disconnected 清理）
- [ ] 进阶练习：用 ClientConnection 模式重写 Tcpserver（每个客户端一个对象 + 广播）
- [ ] 实验：服务器不开，客户端点连接，观察 `errorOccurred` 与 `errorString()`
- [ ] 用 Wireshark 抓包，亲眼看看三次握手和收发数据包
- [ ] 学习 TCP 粘包/拆包，用"长度头"协议改造今天的程序（见《Qt网络编程学习路线.md》阶段二）

---

*下一讲预告：Qt 网络编程 02 —— 粘包拆包与自定义协议。*