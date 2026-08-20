# 达梦学习笔记系列（MVC 与达梦集成）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `DevNotes/Database/` 下建立达梦数据库学习笔记系列：路线图 + 第一篇《Qt-MVC 与达梦数据库集成》。

**Architecture:** 两个 Markdown 文件：`达梦学习路线.md`（总览与进度）与 `01-Qt-MVC与达梦数据库集成.md`（自包含的详细技术笔记，数据库部分详细、与 MySQL 对比、业务代码用伪代码）。笔记风格与 `Qt/`、`Go/` 目录现有笔记一致。

**Tech Stack:** Markdown（UTF-8 编码），中文，Git。

## Global Constraints

- 所有笔记为中文，UTF-8 编码。
- 文件路径精确为 `Database/达梦学习路线.md` 与 `Database/01-Qt-MVC与达梦数据库集成.md`。
- 业务代码允许伪代码；数据库连接、SQL、QSqlTableModel 等关键代码需给出真实可用的代码片段。
- 104 规约仅作背景简讲（帧结构 + 伪代码解析），不展开规约细节（留给第 04 篇）。
- MVC 基础原理（QModelIndex/Role/Delegate）不重复讲解，引用 `Qt/Qt_ModelView_MVC架构详解.md`。
- 与 MySQL 的对比必须贯穿：连接方式、驱动、语法、字符集、事务。
- 达梦关键事实：端口 5236、ODBC 驱动、`COMPATIBLE_MODE` 兼容 MySQL 语法。
- 提交信息风格参照仓库：`feat(Database): <中文说明>`。

---

### Task 1: 创建《达梦学习路线.md》

**Files:**
- Create: `Database/达梦学习路线.md`

**Interfaces:**
- Produces: 路线图文件，包含背景定位、章节规划表（含本次 01 篇标记为已写）、学习路径建议。Task 2 依赖此文件确认系列结构。

- [ ] **Step 1: 确认 Database 目录当前状态为空文件之外无其他内容**

Run: `Get-ChildItem "D:\projects\DevNotes\Database" -Recurse`
Expected: 无文件（或仅 .gitkeep）。

- [ ] **Step 2: 写入《达梦学习路线.md》**

内容要求（使用 write 工具）：
- 标题 `# 达梦数据库学习路线（Qt/C++ 电力运维场景）`
- 背景定位段：电力设备运维、IEC 104 报文传输、Qt/C++、国产数据库、与 MySQL 对比教学
- 章节规划表（编号 | 标题 | 内容 | 状态），共 5 章：
  - 01-Qt-MVC与达梦数据库集成 —— 已写（本次）
  - 02-连接与驱动 —— 待写（ODBC/连接串/兼容模式）
  - 03-基础SQL与MySQL对比 —— 待写（数据类型/建表/CRUD/达梦特有语法）
  - 04-IEC104规约报文实战 —— 待写（报文解析→落库→界面联动）
  - 05-进阶-事务与运维 —— 待写（事务/存储过程/备份恢复/性能）
- 学习路径建议小节（先 01 建立整体认识，再补 02/03 基础，04 回到报文实战）
- 进度表（✅ 已写 / ⬜ 待写）

- [ ] **Step 3: 验证文件**

Run: `Get-Item "D:\projects\DevNotes\Database\达梦学习路线.md" | Select-Object Length` 并 `Get-Content -Encoding UTF8` 检查关键章节存在。
Expected: 文件存在、>1000 字节、包含「章节规划」「01-Qt-MVC」字样。

- [ ] **Step 4: 提交**

```bash
git add "Database/达梦学习路线.md"
git commit -m "feat(Database): 添加达梦学习路线图"
```

---

### Task 2: 创建《01-Qt-MVC与达梦数据库集成.md》

**Files:**
- Create: `Database/01-Qt-MVC与达梦数据库集成.md`

**Interfaces:**
- Consumes: Task 1 确定的系列结构（01 编号）。
- Produces: 完整技术笔记，供后续 02-05 篇引用（连接串写法、QSqlTableModel 用法将在 02 篇深化）。

- [ ] **Step 1: 写入《01-Qt-MVC与达梦数据库集成.md》**

内容要求（使用 write 工具，目标 500-700 行），章节结构：

1. **场景背景**（简短）
   - 电力设备运维：变电站设备经 IEC 104 规约上送遥测（YC）/遥信（YX）报文
   - 链路图：104 报文 → Qt 服务端接收 → 解析 → 达梦落库 → MVC 界面展示
   - 说明：MVC 基础原理见 `Qt/Qt_ModelView_MVC架构详解.md`（给相对链接 `../Qt/Qt_ModelView_MVC架构详解.md`）

2. **达梦连接配置（详细）**
   - Qt 无原生达梦驱动 → 走 ODBC；达梦安装后自带 DM ODBC 驱动
   - 连接串：`Driver={DM8 ODBC DRIVER};Server=localhost;Port=5236;Database=DAMENG`（注释说明 Database 为模式名）
   - QSqlDatabase 建立连接真实代码（addDatabase("QODBC")、setDatabaseName(连接串)、open、错误处理）
   - 与 MySQL 对比：QMYSQL 直连 vs QODBC；端口 3306 vs 5236
   - 达梦 `COMPATIBLE_MODE`（兼容模式）说明：达梦 8 支持兼容 MySQL 语法（建库语句层面），注意事项
   - 达梦自带工具：disql / DM 管理工具 / DM 数据迁移工具（MySQL→达梦迁移）

3. **三种数据库 Model 详解（详细）**
   - 继承关系图（文本）：QSqlQueryModel → QSqlTableModel → QSqlRelationalTableModel
   - QSqlQueryModel：任意 SQL、只读、适合统计/视图（伪代码示例：告警统计）
   - QSqlTableModel：单表读写、setTable/setEditStrategy/select/insertRow/submitAll，真实代码
   - QSqlRelationalTableModel：外键关联显示（设备表→设备类型表），setRelation 示例
   - 每种 Model 给出「达梦 + MySQL 通用性」说明：代码完全一致，仅连接串不同
   - 三种 Model 对比表：只读性 | 适用场景 | 单表/多表 | 编辑能力

4. **业务链路实现（伪代码 + 关键真码）**
   - 104 报文背景简讲：帧格式（启动字符 0x68 + APDU）、类型标识（遥测 9/遥信 1）、伪代码解析
   - 报文接收 → 解析 → 达梦 INSERT（QSqlQuery 预处理 prepare/bindValue，真实代码）
   - QSqlTableModel 绑定遥测表 → QTableView 展示 → 报文到达后 `model->select()` 刷新
   - setEditStrategy 三种策略说明（OnFieldChange/OnRowChange/OnManualSubmit）与场景选择
   - 排序 setSort、筛选 setFilter（与 SQL WHERE 对应）
   - 伪代码整体链路串联（报文线程 → 写库线程 → 界面线程 select 刷新）

5. **与 MySQL 对比表**
   - 表格：驱动类型 | 连接串 | 端口 | 语法兼容 | 字符集默认 | 事务 | 生态与许可

6. **常见坑（详细）**
   - ODBC 32/64 位必须与 Qt 编译位数一致（最常见坑）
   - 端口 5236、服务名 vs 模式名概念
   - 字符集：达梦默认 GBK vs MySQL utf8mb4，连接串/建库指定 UTF-8
   - 事务未提交导致界面数据不更新；锁等待（达梦默认行锁）
   - QSqlTableModel setTable 表名大小写问题（达梦默认大写标识符）

7. **延伸阅读**：`../Qt/Qt_ModelView_MVC架构详解.md`、`../Qt/Qt网络编程-01-TCP客户端与服务器.md`

- [ ] **Step 2: 验证文件**

Run: `Get-Content "D:\projects\DevNotes\Database\01-Qt-MVC与达梦数据库集成.md" -Encoding UTF8 | Measure-Object -Line`
Expected: >400 行；grep 检查关键内容存在：`QODBC`、`5236`、`QSqlTableModel`、`COMPATIBLE_MODE`、`IEC`、`MySQL`。

- [ ] **Step 3: 提交**

```bash
git add "Database/01-Qt-MVC与达梦数据库集成.md"
git commit -m "feat(Database): 添加 Qt-MVC 与达梦数据库集成笔记"
```

---

### Task 3: 收尾验证与提交 spec 关联

**Files:**
- Verify: `Database/` 目录内容

- [ ] **Step 1: 目录最终确认**

Run: `Get-ChildItem "D:\projects\DevNotes\Database" -Recurse -File | Select-Object FullName, Length`
Expected: 两个文件存在（达梦学习路线.md + 01-*.md），大小合理（路线图 >1KB，01 笔记 >20KB）。

- [ ] **Step 2: 更新 README.md 目录表**

在 `D:\projects\DevNotes\README.md` 的目录表中 Database 行：确认存在或补充 `| [Database/](Database/) | 数据库学习笔记（达梦） |`。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: README 补充 Database 目录说明"
```

---

## Self-Review 结果

- **Spec 覆盖**：路线图（Task 1）、01 笔记七大章节（Task 2）、进度与验收（Task 3）。spec 中「104 仅背景简讲」「引用 Qt 旧笔记」「与 MySQL 对比贯穿」均已落到具体章节要求。
- **占位符扫描**：无 TBD/TODO；所有内容要求具体到章节与关键词。
- **一致性**：文件命名与 spec 一致（`01-Qt-MVC与达梦数据库集成.md`）；连接串、端口 5236、`COMPATIBLE_MODE` 等事实在 Task 1/2 中表述一致。