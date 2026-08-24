---
name: cpp-learning-progress
description: C++ 学习现状与下一步
metadata:
  type: learning
---

## 当前进度

- 已有笔记:基础(`namespace_const_constexpr知识点总结.md`)+ 四个薄弱模块:
  - `02-网络编程基础.md`(Socket / TCP/UDP)
  - `03-线程基础.md`(std::thread / join-detach)
  - `04-并发编程.md`(mutex / 条件变量 / atomic / 死锁)
  - `05-函数指针与函数式编程.md`(函数指针 / std::function / lambda)
- 备注:网络、线程、并发、函数指针是用户自述的薄弱项,从零起步,笔记为入门向。

## 下一步

- 实操:跑通 TCP 服务器 + 多线程 + 锁的例子;函数指针做排序比较器。
- 进阶:IO 多路复用(select/epoll)、线程池、`std::async`/future 等(在导航/计时.md 中已列出)。