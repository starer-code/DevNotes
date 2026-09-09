# AI 时代 Qt 开发新路线(ACP + 专家模式)

> 适用人群:有 Qt/C++ 基础,想了解 2026 年 AI 如何重塑 Qt 开发工作流的人。
> 更新日期:2026-08-21

## 目录

- [1. 时代背景:IDE 接入 ACP](#1-时代背景ide-接入-acp)
- [2. qt专家模式:降低 LLM 幻觉的核心手段](#2-qt专家模式降低-llm-幻觉的核心手段)
- [3. 本区落地项目](#3-本区落地项目)
- [4. 关键技术点](#4-关键技术点)
- [5. 学习方向](#5-学习方向)

---

## 1. 时代背景:IDE 接入 ACP

> **核心要点**:AI 不再是一个网页对话框,而是被「缝」进开发工具——Qt Creator 20 原生支持四种 AI 连接方式,其中 ACP Client 让 AI 代理能直接改代码、跑命令、触发构建。

- **ACP(Agent Client Protocol)** 是客户端软件与 AI 编程代理之间的**开放协议**(Zed 团队维护),让 IDE 原生出现「侧栏 agent」——类似 VS Code Copilot 侧栏的效果。
- **已确认(2026-08-21,官方文档)**:Qt Creator 20 的「Using AI」一节列出四种 AI 扩展:

| 扩展 | 作用 |
|---|---|
| **ACP Client** | 用 ACP 连接理解你代码库的 AI 代理,替你改文件、跑命令、触发构建(需配合 MCP Server 扩展启用动作) |
| **GitHub Copilot** | 接入 Copilot,编辑模式内补全建议 |
| **MCP Server** | 让 AI 助手经 MCP 控制 Qt Creator(调试 / 构建 / 工程管理) |
| **Qt AI Assistant** | Qt 自带编程助手,接 LLM 后自动补全、建议修复、写测试与文档 |

- 官方链接:https://doc.qt.io/qtcreator/creator-using-ai.html(20.0 快照:https://doc-snapshots.qt.io/qtcreator-20.0/creator-using-ai.html)
- 意义:AI 从「聊天窗口」升级为「**开发环境里的协作者**」;而要让这个协作者说对 Qt,就得解决它记不住 / 会乱编 API 的问题 —— 这就是下一节。

## 2. qt专家模式:降低 LLM 幻觉的核心手段

> **核心要点**:不让 AI 背文档,而是让它「先抓官方文档回来,再基于抓到的文本作答」——这就是 Agentic RAG。

| 环节 | 做什么 | 防什么 |
|---|---|---|
| 意图映射 | 「线程怎么用」→ `QThread`(映射表 `mapping.json` + 领域推断) | 类名查不到 404 |
| 官方数据 | 抓 `doc.qt.io/qt-6/{类名}.html`,继承链递归展开 | AI 凭记忆编造不存在的方法 |
| 小白化总结 | 构造函数 / 最常用函数 / 关键信号 / 示例 / ⚠️ 注意 | 官方文档冗余劝退 |
| 会话隔离 | **显式开启专家模式**才生效,非 Qt 问题不劫持 | 误伤 Java/Web 等正常问答 |

**为什么比直接问网页版强:** 网页版 LLM 会「幻觉」出新版 API;专家模式强制它「只基于抓到的官方文档文本推理」,幻觉被结构性消除。

## 3. 本区落地项目

- [`qt-doc/`](qt-doc/):qt-doc skill 完整实现(脚本 + skill + 测试 + 设计文档)。
- `qt-doc/docs/QT专家模式测试对话记录.md`:专家模式触发行为的三组验证对话(开启 / 非 Qt 问题不套用 / Qt 问题走文档)。
- 接口说明与用法见 [`qt-doc/AGENTS.md`](qt-doc/AGENTS.md)。

## 4. 关键技术点

| 技术 | 说明 |
|---|---|
| 三级数据源 | 在线 → 本地离线(`QT_DOC_ROOT` 下 Docs/)→ JSON 缓存,断网可用、二次查询秒回 |
| 继承链展开 | 查 `QTcpSocket` 返回 `QAbstractSocket→QIODevice→QObject` 整族,API 标注 `inheritsFrom` |
| 并发 + 缓存 | 一次查多个类并发抓取;缓存落盘,二次查询毫秒级 |
| 防呆 | 类不存在明确报错;`mapping.json` 兜底表保证 100% 映射准确 |

## 5. 学习方向

- [ ] **阶段一**:`python qt_fetch.py QThread QTimer` 跑通抓取,读 `qt-doc/SKILL.md` 输出规范。
- [ ] **阶段二**:在 Qt Creator 20 的 ACP 侧栏里显式开启专家模式,体验「说意图 → 得答案」闭环。
- [ ] **阶段三(进阶)**:扩展 —— 离线 `.qch` 解析、多版本 Qt 文档(5.15/6.x)、反向查询 / embedding 向量检索;或把「专家模式」思路复制到其他领域 skill。
- [ ] **阶段四(方向)**:把工具封装成 MCP 服务,让任意 AI 回答 C++ 问题时实时查官方文档 —— 这是「AI 原生应用」的落地范式。

> 一句话:**AI 时代做 Qt 开发,已经不是「会不会用 API」,而是「会不会让 AI 用对 API」**。qt-doc 的思路(官方数据兜底 + 领域 intent 映射)就是你掌握这门手艺的起点。