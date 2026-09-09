# QT 专家模式测试对话记录

> 用途:作为 qt-doc skill 的测试样例,验证"开启专家模式 → 会话内所有 Qt 问题走官方文档流程"的行为。

---

## 对话 1:开启 QT 专家模式

**用户**: 开启QT专家模式

**助手**: [加载 qt-doc skill]
Qt 专家模式已开启。本会话内所有 Qt/C++ 问题将按官方文档流程回答,输出带 `[qt-doc]` 前缀。

---

## 对话 2:非 Qt 问题(Java 线程)——验证不套用 Qt 流程

**用户**: 查一下java线程

**助手**: 这个问题不属于 Qt 范围,按通用知识正常回答(不套用 Qt 文档流程)。

**Java 线程核心要点:**

- 创建方式(3种)
  1. 继承 `Thread`
  2. 实现 `Runnable`(推荐)
  3. `Callable<T>` + `FutureTask`(可返回结果/抛异常)
- 生命周期状态:`NEW → RUNNABLE → BLOCKED/WAITING/TIMED_WAITING → TERMINATED`
- 常用方法:`start()`, `sleep(ms)`, `join()`, `interrupt()`, `yield()`
- 注意:共享变量用 `synchronized` / `volatile` / `Lock`;生产优先用 `java.util.concurrent` 包

---

## 对话 3:Qt 线程问题——验证走官方文档流程

**用户**: qt中线程

**助手**: [映射"线程"→ QThread,抓取 QThread + QThreadPool 官方文档]

**[qt-doc] Qt 中的线程,核心是 QThread**

**这是什么**:Qt 平台无关的线程类,用于管理一个操作系统线程的创建、运行与结束。它自身也是 QObject,能用信号槽机制与主线程通信。

**继承链**:`QThread` → `QObject`

**构造函数**
- `QThread::QThread(QObject *parent = nullptr)`

**最常用函数**
- `void start(QThread::Priority priority = InheritPriority)` — 启动线程
- `virtual void run()` — 线程入口函数,必须重写,放耗时任务
- `bool wait(unsigned long time)` — 阻塞直到线程结束
- `[static] QThread *currentThread()` — 当前线程对象指针
- `[static noexcept] int idealThreadCount()` — CPU 核心数
- `void requestInterruption()` + `bool isInterruptionRequested()` — 协作式中断
- `[slot] void quit()` / `void exit(int returnCode = 0)` — 退出事件循环
- `[static] void msleep(unsigned long msecs)` / `sleep(secs)` / `usleep(usecs)`

**关键信号**
- `started()` — 线程开始执行时发出
- `finished()` — 线程即将退出时发出

**推荐用法**

方式一:Worker 对象 + moveToThread(最常用)
```cpp
class Worker : public QObject {
    Q_OBJECT
public slots:
    void doWork() { /* 耗时任务 */ }
signals:
    void done();
};

auto *thread = new QThread;
auto *worker = new Worker;
worker->moveToThread(thread);
connect(thread, &QThread::started, worker, &Worker::doWork);
connect(worker, &Worker::done, thread, &QThread::quit);
connect(thread, &QThread::finished, worker, &Worker::deleteLater);
thread->start();
```

方式二:子类化 QThread(仅适合简单任务)
```cpp
class MyThread : public QThread {
protected:
    void run() override { qDebug() << "working..."; }
};
MyThread t;
connect(&t, &QThread::finished, &t, &QObject::deleteLater);
t.start();
```

方式三:线程池 `QThreadPool`
- `QThreadPool::globalInstance()->start(QRunnable*)`
- 关键成员:`maxThreadCount`(默认 `idealThreadCount()`)、`start(QRunnable*)`、`waitForDone(int msecs)`、`clear()`

**⚠️ 注意**
1. 绝不直接在子线程操作 UI:用信号槽或 `QMetaObject::invokeMethod`
2. `terminate()` 是危险操作,用 `requestInterruption()` + `wait()` 收尾
3. `moveToThread` 的对象不能有父对象
4. `Qt::AutoConnection` 跨线程自动转 Queued
5. 重写 `run()` 时不调用 `exec()` 则不进事件循环
6. 有返回值异步任务优先 `QtConcurrent::run()` + QFuture

---

## 验证要点总结

| 触发词 | 预期行为 | 本记录中的表现 |
|--------|----------|----------------|
| 开启QT专家模式 | 加载 qt-doc skill,会话内 Qt 问题走文档流程 | ✅ 对话 1 |
| 非 Qt 问题(Java/Web) | 正常回答,不套用 Qt 文档流程 | ✅ 对话 2 |
| Qt 问题("线程") | 映射类名 → 抓官方文档 → 小白化总结,带 `[qt-doc]` 前缀 | ✅ 对话 3 |
