# Qt MVC 与达梦数据库集成

> 电力设备运维场景：变电站设备经 IEC 104 规约报文上送遥测/遥信数据，Qt 后台接收解析后写入达梦数据库，界面用 Qt Model/View（MVC）框架展示。
> 数据库部分讲解详细，全程与 MySQL 对比。

---

## 一、场景背景

**业务链路：**

```
变电站设备 --(IEC 104 报文)--> Qt 后台 TCP 服务端 --> 报文解析
      --> 达梦数据库(DM8) --> QSqlTableModel --绑定--> QTableView 界面
```

- **遥测（YC）**：电流、电压、功率等模拟量，周期上送。
- **遥信（YX）**：开关位置、刀闸状态等开关量，变位上送。

**本篇定位**：MVC 基础原理（QModelIndex/Role/Delegate 机制）已在
[../Qt/Qt_ModelView_MVC架构详解.md](../Qt/Qt_ModelView_MVC架构详解.md) 详细讲解，本篇不重复，
重点放在**数据库侧**：达梦连接、三种数据库 Model 的用法、报文落库与界面刷新的完整链路。

---

## 二、达梦连接配置（详细）

### 2.1 为什么 Qt 用 ODBC 连接达梦

| 对比项 | 达梦 DM8 | MySQL |
|---|---|---|
| Qt 驱动 | 无官方原生驱动，走 **ODBC**（`QODBC`） | 官方 `QMYSQL` 驱动 |
| 端口 | 5236 | 3306 |
| 驱动来源 | 达梦安装目录自带 DM ODBC 驱动（`dm_odbc`） | Qt 编译时编译 qsqlmysql 插件 |

MySQL 有 `QMYSQL` 驱动，直接 `QSqlDatabase::addDatabase("QMYSQL")` 即可。
达梦没有对应的 Qt 原生驱动，只能通过微软 ODBC 或 unixODBC 桥接，Qt 侧统一使用 `QODBC`。

### 2.2 达梦 ODBC 驱动

达梦安装后，在 `安装目录/drivers/odbc/` 下提供 ODBC 驱动库：

- Windows：`dm8_odbc.dll`（32 位） / `dm8_odbc64.dll`（64 位）
- Linux：`libdm8_odbc.so`

**ODBC 位数必须与 Qt 程序位数一致**（最常见坑，详见第六章）。
注册 ODBC 驱动（Windows，管理员 cmd）：

```bat
:: 64 位 Qt 程序 → 注册 64 位驱动
regsvr32 "C:\dmdbms\drivers\odbc\dm8_odbc64.dll"

:: 或写入 ODBC 数据源（控制面板/管理工具/ODBC 数据源）
:: 系统 DSN：名称 DM8DSN，服务器 localhost，端口 5236
```

### 2.3 QSqlDatabase 连接代码（真实可用）

```cpp
#include <QSqlDatabase>
#include <QSqlError>
#include <QDebug>

bool connectDameng()
{
    // 1. 注册驱动（也可用 QSQLITE 之外的驱动名区分）
    QSqlDatabase db = QSqlDatabase::addDatabase("QODBC");  // 驱动名：ODBC

    // 2. 连接串（三种写法，任选其一）
    // 写法A：使用已配置的 ODBC 数据源名（DSN）
    db.setDatabaseName("DM8DSN");

    // 写法B：直接写连接串（无需先建 DSN，推荐）
    // 注意：Database 在达梦里指"模式(Schema)"，默认模式名为 DAMENG
    QString conn = QString(
        "Driver={DM8 ODBC DRIVER};"
        "Server=%1;Port=%2;Database=%3;")
        .arg("127.0.0.1").arg(5236).arg("DAMENG");
    db.setDatabaseName(conn);

    // 写法C：带字符集与用户名
    // 建议指定 UTF-8 字符集，避免中文乱码
    QString conn2 = QString(
        "Driver={DM8 ODBC DRIVER};Server=127.0.0.1;Port=5236;"
        "Database=DAMENG;UserID=SYSDBA;Password=***;"
        "Charset=UTF8;");   // 达梦 ODBC 字符集选项
    db.setDatabaseName(conn2);

    // 3. 设置账号密码
    db.setUserName("SYSDBA");   // 达梦默认管理员账户，类似 MySQL 的 root
    db.setPassword("SYSDBA");

    // 4. 打开连接
    if (!db.open()) {
        qCritical() << "达梦连接失败:" << db.lastError().text();
        return false;
    }
    qDebug() << "达梦连接成功, 驱动:" << db.driverName();
    return true;
}
```

**与 MySQL 对比：**

```cpp
// MySQL 写法（对比）
QSqlDatabase db = QSqlDatabase::addDatabase("QMYSQL");
db.setHostName("127.0.0.1");
db.setPort(3306);
db.setDatabaseName("mydb");      // MySQL 里 database 是"数据库"
db.setUserName("root");
db.setPassword("***");
db.open();
```

> **要点**：达梦连接串里 `Database` 实际对应**模式（Schema）**，与 MySQL 的 database 概念不同。
> 达梦一个实例可建多个用户，每个用户默认对应同名模式。登录用户不同，看到的模式不同。

### 2.4 达梦兼容模式 COMPATIBLE_MODE

达梦 8 通过 `COMPATIBLE_MODE` 兼容其他数据库语法，取值：

| 值 | 兼容目标 | 说明 |
|---|---|---|
| 0 | 不兼容 | 达梦原生语法 |
| 1 | 兼容 Oracle | 默认 |
| 2 | 兼容 SQL Server | |
| 3 | 兼容 ANSI | |
| 4 | 兼容 MySQL | **本系列关注** |

**配置方式**（建库时指定，`dm.ini` 或建库语句）：

```sql
-- 建库时指定兼容模式（dminit 建库工具）
dminit PATH=/dm/data DB_NAME=DAMENG COMPATIBLE_MODE=4

-- 或运行时查询/设置
SELECT * FROM v$dm_ini WHERE para_name = 'COMPATIBLE_MODE';
```

> **注意**：兼容模式主要影响 SQL 语法解析（如 `LIMIT`、反引号、`auto_increment` 等）。
> 它**不改变存储引擎架构**，达梦仍是关系型行列存储，没有 MySQL 的 InnoDB/MyISAM 之分。
> 连接方式（ODBC）、事务、锁模型仍是达梦自己的。

### 2.5 达梦常用工具

| 工具 | 用途 | 类似 MySQL |
|---|---|---|
| `disql` | 命令行 SQL 工具 | `mysql` 命令行 |
| DM 管理工具 | 图形化管理（建表/数据查看/调试） | Navicat / Workbench |
| DM 数据迁移工具 | MySQL → 达梦 数据迁移 | mysqldump |
| DM 控制台 / dm.ini | 实例配置 | my.ini |

---

## 三、三种数据库 Model 详解

### 3.1 继承关系

```
QObject
 └── QAbstractItemModel            （Item Model 基类）
     ├── QAbstractListModel
     └── QAbstractTableModel
         ├── QSqlQueryModel         ← 只读，任意 SQL
         ├── QSqlTableModel         ← 单表读写
         └── QSqlRelationalTableModel ← 单表 + 外键关联显示
```

三种 Model 都属于 Qt SQL 模块（`QtSql`），**底层不区分达梦还是 MySQL**——
只要 `QSqlDatabase` 连上了库，用法完全一致。这是 Qt 屏蔽数据库差异的最大好处。

### 3.2 QSqlQueryModel —— 只读查询模型

适合：统计报表、自定义复杂 SQL、不需要编辑的场景（如"今日告警数量"、"电压越限列表"）。

```cpp
// 真实代码：查询遥测数据中的越限记录
QSqlQueryModel *model = new QSqlQueryModel(this);
model->setQuery(
    "SELECT device_name, yc_name, yc_value, alarm_flag "
    "FROM telemeter WHERE alarm_flag = 1 AND record_time > '2026-08-20'");

// 设置列头（数据库列名是英文，界面显示中文）
model->setHeaderData(0, Qt::Horizontal, tr("设备名"));
model->setHeaderData(1, Qt::Horizontal, tr("遥测名称"));
model->setHeaderData(2, Qt::Horizontal, tr("遥测值"));
model->setHeaderData(3, Qt::Horizontal, tr("越限标志"));

// 绑定视图
ui->tableView->setModel(model);
```

**特点**：只读，不能编辑单元格；`setQuery` 可随时换成新 SQL 刷新数据。

### 3.3 QSqlTableModel —— 单表读写模型（本篇主角）

适合：直接展示/编辑某张业务表（如设备信息表、遥测明细表）。

```cpp
// 真实代码：绑定设备表，支持界面直接编辑
QSqlTableModel *model = new QSqlTableModel(this, db);
model->setTable("device_info");          // 表名，达梦默认大写标识符
model->setEditStrategy(QSqlTableModel::OnManualSubmit); // 手动提交策略
model->setFilter("station_id = 1001");   // 过滤，等价于 WHERE
model->setSort(1, Qt::AscendingOrder);   // 按第2列升序，等价于 ORDER BY
model->select();                         // 执行 SELECT 加载数据

// 设置中文列头
model->setHeaderData(0, Qt::Horizontal, tr("设备编号"));
model->setHeaderData(1, Qt::Horizontal, tr("设备名称"));
model->setHeaderData(2, Qt::Horizontal, tr("所属站点"));

// 绑定视图
ui->tableView->setModel(model);
ui->tableView->setSelectionBehavior(QAbstractItemView::SelectRows);
```

**setEditStrategy 三种编辑策略：**

| 策略 | 行为 | 适用场景 |
|---|---|---|
| `OnFieldChange` | 单元格一改就立即写库 | 单用户、数据量小 |
| `OnRowChange` | 切行时提交本行修改 | 常见的表单式编辑 |
| `OnManualSubmit` | 手动调用 `submitAll()` 才写库 | 报文批量入库、需要回滚的场景 |

```cpp
// OnManualSubmit 模式下手动提交/回滚
if (model->submitAll()) {
    qDebug() << "已保存到达梦";
} else {
    qDebug() << "保存失败:" << model->lastError().text();
    model->revertAll();   // 撤销所有未提交修改
}
```

### 3.4 QSqlRelationalTableModel —— 外键关联模型

适合：表中有外键，希望视图里直接显示关联表的名称列（而不是外键编号）。

场景：遥测表 `telemeter` 存的是 `device_id`，希望界面显示设备名称而不是编号。

```cpp
// 真实代码：遥测表 + 设备表关联
QSqlRelationalTableModel *model = new QSqlRelationalTableModel(this, db);
model->setTable("telemeter");
model->setRelation(1,  // 第2列是 device_id（外键）
    QSqlRelation("device_info", "device_id", "device_name"));  // 关联到设备表

// 用 QSqlRelationalDelegate 让视图以下拉框形式显示关联列
ui->tableView->setItemDelegate(
    new QSqlRelationalDelegate(ui->tableView));

model->select();
```

### 3.5 三种 Model 对比

| 对比项 | QSqlQueryModel | QSqlTableModel | QSqlRelationalTableModel |
|---|---|---|---|
| 只读/读写 | 只读 | 读写 | 读写 |
| 表范围 | 任意 SQL/多表 | 单表 | 单表 + 外键 |
| 编辑能力 | 无 | 单元格编辑 | 单元格编辑 + 关联下拉 |
| 典型场景 | 统计报表 | 业务表维护 | 有外键的明细表 |
| 达梦/MySQL | 通用 | 通用 | 通用 |

> **通用性结论**：三种 Model 在达梦与 MySQL 下**代码完全相同**，差异只在最上层连接串。
> 所以学会了 MySQL 的 Qt MVC 用法，达梦直接无缝迁移。

---

## 四、业务链路实现（伪代码 + 关键真码）

### 4.1 IEC 104 报文背景（简讲）

IEC 60870-5-104 是电力远动标准规约，基于 TCP 传输，帧结构核心（APDU）：

```
启动字符 0x68 + 长度 + 控制域(4字节) + 类型标识 + 传送原因 + 公共地址 + 信息体
        ^ 帧头      ^ APDU长度    ^ 规约控制信息      ^ ASDU 部分
```

常用类型标识：

| 类型标识 | 含义 | 对应业务 |
|---|---|---|
| 1 (M_SP_NA) | 单点遥信 | 开关位置 |
| 9 (M_ME_NA) | 遥测（短浮点） | 电流/电压/功率 |
| 100 (C_IC_NA) | 总召唤 | 启动时全量上送 |

### 4.2 伪代码：报文 → 解析 → 落库 → 界面刷新

```cpp
// ============ 伪代码（业务逻辑示意） ============

// ① 线程A：TCP 接收报文（QUdpSocket/QTcpSocket）
void Iec104Server::onDataReady() {
    QByteArray frame = socket->readAll();
    emit packetParsed(parse104(frame));   // 信号携带解析结果
}

// ② 线程B：报文解析 → 组装成业务结构体
ParsedPacket parse104(const QByteArray &frame) {
    ParsedPacket p;
    if (frame[0] != 0x68) return p;              // 帧头校验
    p.typeId = frame[6];                         // 类型标识
    p.deviceId = 取公共地址/信息体中的设备号;
    if (p.typeId == 9) p.ycValue = 解析短浮点;   // 遥测值
    if (p.typeId == 1) p.yxStatus = 解析开关位;   // 遥信状态
    return p;
}

// ③ 线程C：写入达梦（QSqlQuery 预处理，真实代码）
bool writeToDameng(const ParsedPacket &p) {
    QSqlQuery q(db);
    q.prepare(
        "INSERT INTO telemeter(device_id, yc_name, yc_value, record_time) "
        "VALUES(:dev, :name, :val, NOW())");
    q.bindValue(":dev",  p.deviceId);
    q.bindValue(":name", "遥测1");        // 实际按点号查配置表
    q.bindValue(":val",  p.ycValue);
    return q.exec();
}

// ④ 界面线程：报文入库后刷新表格（QSqlTableModel::select 重新查询）
//    信号槽跨线程安全：model 在界面线程，报文线程发信号触发
void MainWindow::onPacketStored() {
    model->select();   // 关键：重新查库，界面自动刷新
}
```

**关键点：**

1. `model->select()` 会重新执行 SELECT，最新入库的数据立即出现在表格。
2. 信号槽跨线程自动排队（`Qt::QueuedConnection`），数据库写操作不阻塞界面。
3. 高并发上报时，可在写库线程内做 `QSqlDatabase` 事务批量提交（见 4.3）。

### 4.3 批量入库优化（真实代码）

104 报文可能每秒几十帧，逐条提交太慢，用事务批量提交：

```cpp
// 事务批量写入（对比 MySQL 用法完全一致）
db.transaction();
QSqlQuery q(db);
q.prepare("INSERT INTO telemeter(device_id, yc_value, record_time) "
          "VALUES(:dev, :val, NOW())");

for (const ParsedPacket &p : packets) {
    q.bindValue(":dev", p.deviceId);
    q.bindValue(":val", p.ycValue);
    q.exec();
}
db.commit();   // 一次性提交，性能提升明显

// 失败回滚
// db.rollback();
```

### 4.4 界面联动：筛选、排序、点击行查看详情

```cpp
// 表格按站点筛选（等价于 SQL WHERE）
model->setFilter(QString("station_id = %1").arg(currentStation));
model->select();

// 点击行获取原始数据
void MainWindow::onTableClicked(const QModelIndex &idx) {
    int row = idx.row();
    int deviceId = model->record(row).value("device_id").toInt();
    QString ycValue = model->record(row).value("yc_value").toString();
    // 弹窗或右侧面板显示该设备详情
}
```

---

## 五、与 MySQL 对比表（汇总）

| 对比项 | 达梦 DM8 | MySQL |
|---|---|---|
| Qt 驱动 | QODBC（ODBC 桥接） | QMYSQL |
| 端口 | 5236 | 3306 |
| 连接串 | 驱动+服务器+端口+Database(模式) | 主机+端口+数据库名 |
| 默认管理员 | SYSDBA | root |
| 大小写 | 默认大写标识符（不区分大小写） | 大小写敏感（Linux 下） |
| 字符集默认 | GBK（可指定 UTF-8） | utf8mb4 |
| 兼容模式 | COMPATIBLE_MODE=4 兼容 MySQL 语法 | 原生 |
| 事务 | 支持，默认行级锁 | InnoDB 事务 |
| 数据类型 | INT/NUMBER/VARCHAR/CLOB 等 | INT/DECIMAL/VARCHAR/TEXT |
| 自增列 | 序列 SEQUENCE 或 auto_increment(兼容模式) | AUTO_INCREMENT |
| 生态 | 国产化、信创环境 | 开源生态大 |
| 许可 | 商业授权 | 开源/商业 |

---

## 六、常见坑与调试技巧

### 6.1 ODBC 32/64 位不匹配（最容易踩）

**现象**：`open()` 失败，报 "driver not found" 或 "无法加载 ODBC 驱动"。
**原因**：Qt 程序是 64 位，却注册了 32 位 DM ODBC 驱动（或反之）。
**解决**：查看 Qt 位数 → 注册对应位数的 dm8_odbc64.dll（64 位）或 dm8_odbc.dll（32 位）。

```powershell
# 查看 Qt 程序位数（构建时确定），用同位数 ODBC 管理工具注册
# 64位：C:\Windows\System32\odbcad32.exe
# 32位：C:\Windows\SysWOW64\odbcad32.exe
```

### 6.2 连接串报错排查

- 端口错误 → 确认 dm.ini 中的 PORT_NUM（默认 5236）。
- `Database=DAMENG` 的 DAMENG 是**模式名**，默认管理员 SYSDBA 的模式是 DAMENG。
- 连接串里分号分隔，不要漏掉结尾分号。
- 测试连接：`disql SYSDBA/SYSDBA@127.0.0.1:5236`

### 6.3 中文乱码

- 达梦默认字符集常为 GBK，MySQL 默认 utf8mb4。
- 建库时建议指定 UTF-8：`dminit CHARSET=1`（1=UTF-8，0=GBK）。
- 连接串加 `Charset=UTF8`（ODBC 选项）或 `db.setOption` 设置。
- Qt 界面统一使用 UTF-8 源码（`QString::fromUtf8` 或代码文件存 UTF-8）。

### 6.4 表名/列名大小写

- 达梦不区分大小写，但**存储时默认转大写**。
- 用双引号 `"user_table"` 可保留小写：`CREATE TABLE "user_table"(...)`。
- QSqlTableModel 的 `setTable("DEVICE_INFO")` 通常写大写更稳妥。

### 6.5 数据不刷新

- **原因 A**：写库用的连接与 model 用的连接不是同一个事务上下文 → 确保提交后再 `select()`。
- **原因 B**：`setEditStrategy(OnManualSubmit)` 忘了调 `submitAll()`。
- **原因 C**：写了库但没调 `model->select()`。
- **原因 D**：用了事务没 commit，其他连接读不到未提交数据。

### 6.6 锁等待 / 卡死

- 达梦默认行级锁，与 InnoDB 类似；长事务持锁会导致其他会话等待。
- 界面线程不要执行长时间 SQL，放到工作线程。
- 批量入库用事务，但事务要小（几千行一次），避免锁持有过久。

---

## 七、延伸阅读

- [../Qt/Qt_ModelView_MVC架构详解.md](../Qt/Qt_ModelView_MVC架构详解.md) — MVC 基础、QModelIndex/Role/Delegate、自定义 Model、代理与拖拽
- [../Qt/Qt网络编程-01-TCP客户端与服务器.md](../Qt/Qt网络编程-01-TCP客户端与服务器.md) — 报文传输的 TCP 实现基础
- [达梦学习路线.md](./达梦学习路线.md) — 本系列总览
- 后续章节：02 连接与驱动、04 IEC104 规约报文实战