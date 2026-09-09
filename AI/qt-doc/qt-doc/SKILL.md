---
name: qt-doc
description: Use ONLY when the user explicitly asks to enter Qt expert mode (says "开启Qt专家模式", "进入Qt专家模式", "Qt专家模式", or similar). Once triggered, the whole session becomes Qt/C++ expert mode: answer all Qt framework questions using fetched official docs. Do NOT trigger for anything else — not even a bare Qt class name like QThread — unless expert mode is already active in this session.
---

# qt-doc（Qt 智能文档）

**仅当用户显式要求开启 Qt 专家模式时触发**，如说"开启Qt专家模式"、"进入Qt专家模式"、
"Qt专家模式"等。

一旦触发，**本会话进入 Qt 专家模式**，直到会话结束：
- 之后该会话内的所有 Qt/C++ 问题都用本 skill 流程回答（映射类名→抓文档→小白化总结）。
- 会话保持生效：通过 `/sessions` 恢复该对话，专家模式依然生效。
- **新开对话默认不加载本 skill**，需再次显式开启——实现会话级隔离。
- 在专家模式下，非 Qt 的通用编程问题（如 Java/Web）正常回答，不套用 Qt 文档流程。

## 流程

1. 把用户描述映射为 Qt 类名（Q 开头）。
   - 先查本 skill 目录下的 `mapping.json` 精确匹配。
   - 未命中则凭 Qt 领域知识推断（如"画形状"→QPainterPath）。
   - 无法确定时询问用户。
2. 调用抓取脚本（可传多个类名，一次抓取）：
   - 优先使用环境变量 `QT_FETCH_CMD` 指向脚本（如 `python /path/to/qt_fetch.py`）。
   - 未设置时，用当前仓库内脚本：`python <repo>/qt_fetch.py <类名1> <类名2>...`。
   - 示例：`python ../qt_fetch.py QThread QTimer`
3. 读取 stdout JSON。若 `errors` 非空，说明该类未找到，提示用户检查拼写或模块。
4. 基于 JSON 的 `title/brief/apis` 做小白化总结。

## 输出规范（中文，开头带 [qt-doc]）

1. **这是什么**：一句话说明该类用途。
2. **构造函数**：核心 1-2 个。
3. **最常用函数**：数量视类而定——核心常用类 5-8 个，简单类 3-4 个。
4. **关键信号**：1 个 + 触发时机（有信号时）。
5. **示例代码**：简短 5-8 行。
6. **⚠️ 注意**：继承或使用要点。


## 继承链

查询结果含 `inheritance_chain`（从派生到基类）与每个 API 的 `inheritsFrom` 来源。
若某类 API 很少（如 QTcpSocket），说明它继承自父类，常用函数多在父类文档中——
总结时应说明函数来自哪个父类（如 connectToHost 来自 QAbstractSocket）。

## 约束

- 只讲文档中出现的 API，不编造不存在的方法。
- 描述用中文，签名保留原始 C++。
- 网络失败时脚本会自动回退本地文档，无需重试。
- **示例代码必须与注意事项一致**：异步操作必须先等待对应信号（如 connected()）再执行后续步骤，禁止示范与警告相矛盾的模式（如未连接就 write）。示例应体现最安全的写法。
