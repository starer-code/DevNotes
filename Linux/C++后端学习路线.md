# C++ 后端学习路线(以阿里云服务器为练兵场)

> 目标:零基础起步,以阿里云 ECS(2C2G40G)为主战场,系统学习 C++ 后端开发。
> 原则:基础 → 系统 → 网络 → 框架 → 工程化,渐进推进;**每阶段都在云服务器上产出可运行的作品**。
> 制定日期:2026-08-25(基于通用路线定制)

## 总览

| 阶段 | 主题 | 时长 | 云服务器上的产出 |
|---|---|---|---|
| 0 | Linux 基础与服务器上手 | 已完成大半 | workspace 目录、用户权限体系 ✅ |
| 1 | 现代 C++ 核心 | 2-4 周 | 编译运行的工具链熟练度 |
| 2 | Linux 系统与网络编程 | 4-6 周 | **手写并发 HTTP 服务器**(已在路上) |
| 3 | 框架与中间件 | 6-8 周 | Drogon + MySQL + Redis 的 REST API |
| 4 | 工程化与云原生 | 持续 | Docker 化部署 + CI/CD + 监控 |

> 时长按「每天 1-2 小时」估算,弹性理解;项目驱动,不以周数为硬指标。

---

## 阶段 0:Linux 基础与服务器上手 ✅(进行中)

- [x] 云服务器认识与使用(SSH、安全组概念)
- [x] 目录结构 / 磁盘分区与挂载(lsblk、df)
- [x] 基础导航与文件操作(ls / cd / pwd / mkdir / cp / mv / rm)
- [x] 权限体系(权限位、chmod、chown、useradd、su)
- [x] 第一个 C++ HTTP 服务器编译部署,公网访问成功
- [ ] 进程管理入门(nohup / systemd,解决"断线服务就死")
- [ ] tail -f 看日志实战
- [ ] shell 脚本入门(编译部署脚本化)

## 阶段 1:现代 C++ 核心(2-4 周)

**重点:能写出安全的现代 C++ 代码,不陷入语法细节陷阱。**

- [ ] 智能指针(unique_ptr / shared_ptr / weak_ptr)
- [ ] RAII 与资源管理
- [ ] 移动语义与右值引用
- [ ] std::optional / string_view
- [ ] 模板基础(不必精通元编程)
- [ ] CMake 构建(必学,替代手敲 g++)
- [ ] 包管理:Conan 或 vcpkg(了解即可)
- [ ] GDB 调试 + ASan 内存检测(Valgrind 了解)

**产出**:把 http_server.cpp 改造成 CMake 工程;用智能指针重构其中资源管理。

> ⚠️ 避坑:不要大量时间刷算法题、不要钻研 STL 源码实现。优先「写出安全代码」的能力。

## 阶段 2:Linux 系统与网络编程(4-6 周)

**重点:这是 C++ 后端的核心竞争力,当前服务器代码是绝佳起点。**

- [ ] 文件 IO(open / read / write / mmap)
- [ ] 进程与线程(fork / pthread / std::thread)
- [ ] 信号处理(signal / sigaction)
- [ ] Socket API 深入(TCP 状态机、粘包处理)
- [ ] IO 多路复用:select → poll → **epoll**(重点)
- [ ] 并发模型:多线程同步 → Reactor 模式,理解为什么单线程 epoll 比多线程阻塞高效
- [ ] TCP / HTTP 协议本质(报文、状态码、keep-alive、chunked)

**产出(项目驱动,层层递进)**:
1. 手写并发 echo server(多线程版)
2. 升级为 epoll 版 HTTP 服务器(解决今天发现的单线程排队问题)
3. 对照阅读 muduo 源码(陈硕),理解工业级 Reactor 设计

## 阶段 3:主流框架与中间件(6-8 周)

**重点:每个技术点都配一个小项目落地。**

- [ ] Web 框架:**Drogon**(首选,文档完善)或 cpp-httplib(快速原型)
- [ ] MySQL / PostgreSQL + ORM(sqlpp11)
- [ ] Redis 缓存(会话管理、热点缓存)
- [ ] gRPC + Protobuf(RPC 通信)
- [ ] 服务发现与负载均衡(概念 + 简单实践)

**产出**:
1. Drogon + MySQL 的 REST API(如记账本 / 短链服务)
2. 加 Redis 会话管理
3. 两个服务间 gRPC 通信(为分布式打底)

## 阶段 4:工程化与云原生(持续)

- [ ] 测试:Google Test 单元测试 + CTest 集成
- [ ] CI/CD:GitHub Actions 自动构建 / 测试
- [ ] Docker:多阶段构建 C++ 镜像,docker-compose 编排服务 + 数据库
- [ ] Kubernetes 部署基础
- [ ] 可观测性:spdlog 日志、Prometheus 指标、OpenTelemetry 链路追踪(了解)

**产出**:把阶段 3 的 REST API 完整 Docker 化,GitHub Actions 自动部署到阿里云。

---

## 学习原则

1. **项目驱动**:每阶段必须产出可运行作品(REST API、聊天室、分布式 KV),不空学理论。
2. **读优秀源码**:muduo(陈硕)、libuv、nginx 模块——理解工业级设计,不止于能用。
3. **云服务器贯穿始终**:所有项目都部署到 ECS 公网可访问,「写 → 编译 → 部署 → 访问」闭环肌肉记忆化。
4. **资源**:
   - 书:《C++ Concurrency in Action》《Linux 高性能服务器编程》(游双)
   - 视频:B 站「码农高天」C++ 系列
   - 工具:GDB、ASan、perf(性能分析)
5. **就业导向**:国内大厂重基础 + 系统能力(epoll、内存、并发);海外 / 初创更看框架实战。两条腿走路。

## 💡 心法

C++ 后端学习曲线陡峭,回报是对计算机系统的深层理解。**当你能用 epoll 手写高性能服务器时,转 Go / Rust / Java 都是降维打击。** 坚持 6 个月系统训练,可达到初级工程师水平。

> 2C2G 服务器注意:编译大项目内存吃紧时,本地交叉编译后上传,或扩大 swap(已有 swapfile 可扩容)。

---

*进度勾选状态随学习推进更新;详细过程见各篇笔记。*
