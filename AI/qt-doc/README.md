# qt-doc · Qt 智能文档 Skill

**不要死记硬背 Qt 类名，告诉它你想干什么。**

一个为 opencode 设计的 Qt 领域智能体 Skill：你只需要用中文描述需求
（"查一下线程怎么用"），它会自动映射为 `QThread`，抓取官方文档，并返回小白能看懂的核心 API 总结。

> 这不是搜索引擎，这是一个懂 Qt 的领域智能体。

---

## ✨ 它能做什么

| 能力 | 说明 | 示例 |
|---|---|---|
| **意图感知** | 中文概念自动映射为 Qt 类名 | "线程" → `QThread`，"画形状" → `QPainterPath` |
| **继承链展开** | 自动递归抓取父类文档 | 查 `QTcpSocket` 返回整个 `QAbstractSocket→QIODevice→QObject` 族，2 个 API → 216 个 |
| **来源标注** | 每个 API 标注来自哪个类 | `connectToHost`（来自 `QAbstractSocket`） |
| **小白化总结** | 官方文档降维成通俗解释 | 构造函数 / 最常用函数 / 关键信号 / 示例 / 注意事项 |
| **三级数据源** | 在线 → 本地离线文档 → JSON 缓存 | 断网可用，二次查询秒回 |
| **会话隔离** | 显式开启专家模式，不误触发 | 未开启时零劫持 Web/Java 等非 Qt 问题 |

## 🚀 快速开始

### 环境要求

- Python 3.10+
- 依赖：`requests`、`beautifulsoup4`
- [opencode](https://opencode.ai)（可选用任意支持 Skill 的 Agent 运行器）

### 安装

```bash
git clone <your-repo-url> qt-doc
cd qt-doc
pip install -r requirements.txt
# 安装 skill 到 opencode 全局（可选）
cp -r qt-doc ~/.config/opencode/skills/
```

### 使用

重启 opencode 后，在会话中：

```
您: 开启Qt专家模式          ← 唯一触发方式，显式开启
AI: 已进入 Qt 专家模式...
您: 查一下 QTcpSocket 怎么用  ← 会话内一路走 Qt 文档流程
您: 查一下线程和定时器怎么配合
```

**专家模式规则：**
- 未开启时，**任何问题都不会触发**本 skill（包括提到 Qt 类名）。
- 开启后，会话内所有 Qt 问题自动走文档流程，直到会话结束。
- `/sessions` 恢复会话仍生效；新开对话默认不加载——实现会话级隔离。
- 专家模式下非 Qt 问题（Java/Web 等）正常回答，不套用 Qt 流程。

### 命令行直接使用（不经过 AI）

```bash
python qt_fetch.py QThread QTimer          # 抓取多个类
python qt_fetch.py QTcpSocket              # 继承链展开
python qt_fetch.py QNonexistent            # 类不存在时明确报错
```

输出为 stdout JSON，含 `inheritance_chain` 与 `apis[].inheritsFrom`。

## ⚙️ 配置

可通过环境变量自定义，无需改代码：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `QT_DOC_ROOT` | 本地 Qt 文档目录（`Docs/Qt-X.Y`） | 自动探测 `D:/Qt`、`C:/Qt` 等常见位置 |
| `QT_DOC_ONLINE` | 在线文档基址 | `https://doc.qt.io/qt-6` |
| `QT_DOC_CACHE` | 缓存目录 | `~/.cache/qt-doc` |
| `QT_FETCH_CMD` | Skill 调用脚本的命令 | 仓库内 `qt_fetch.py` |

数据源优先级：**在线文档 → 本地离线文档 → 缓存**。

## 🧪 测试

```bash
python -m pytest test_qt_fetch.py -v        # 单元测试（8 项）
python docs/superpowers/tests/skill_trigger_test.py   # 触发规则回归（14 项，秒级）
# 完整交互测试见 docs/superpowers/tests/run-qt-doc-tests.ps1
```

## 📁 项目结构

```
qt-doc/
├── qt_fetch.py          # 抓取/清洗/缓存/继承展开 核心脚本
├── test_qt_fetch.py     # 单元测试
├── requirements.txt     # Python 依赖
├── qt-doc/              # opencode skill 本体
│   ├── SKILL.md         # 触发与总结规范
│   └── mapping.json     # 中文概念 → 类名兜底表
└── docs/
    └── superpowers/
        ├── specs/       # 设计文档
        ├── plans/       # 实施计划
        └── tests/       # 测试用例与报告
```

## 🗺️ 路线图

- [x] 意图感知（中文 → Qt 类名映射）
- [x] 继承链递归展开 + API 来源标注
- [x] 三级数据源（在线 / 本地 / 缓存）
- [x] 会话级隔离（显式专家模式）
- [ ] 离线 `.qch` 文档解析（更完整的本地库）
- [ ] 多版本 Qt 文档切换（5.15 / 6.x）
- [ ] 反向查询（"哪个类有 X 函数"）
- [ ] 语义搜索（文档 embedding + 向量检索）

## 📄 许可

MIT License
