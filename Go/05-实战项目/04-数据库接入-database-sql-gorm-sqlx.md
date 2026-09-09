# 04 - 数据库接入 database/sql · gorm · sqlx

> 从 C++ 的 sqlite3 / libpq + 手写 ORM 到 Go：database/sql 抽象层 + 驱动隔离，数据访问可以有一份标准答案

---

## 一、简述

Go 数据库世界的中心是 `database/sql`——一个**驱动无关的 SQL 访问抽象层**。就像 C++ 里 `sqlite3_open`、`PQconnectdb` 各写各的，Go 则约定「先 `sql.Open` 拿到抽象连接，然后 Query/Exec/事务全走同一套接口」，不同数据库只是**换一个驱动 import 和连接串**。sqlx 在其上补了「结构体 ↔ 行」的便捷映射；gorm 则是全功能 ORM（自动建表、关联、迁移），适合快速开发。三者是「底层 → 便捷 → 全自动」的一条谱系。

> **核心要点**：先记住 `database/sql` 的三个纪律——**连接池要调**、**行/stmt/tx 用后必关**、**占位符随驱动变化**（MySQL 用 `?`，PostgreSQL 用 `$1`）。在这之上，sqlx 与 gorm 都是锦上添花。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 数据库接口 | sqlite3.h / libpq 各一套 | `database/sql` 标准库 | 统一抽象，换库只换驱动/连接串 |
| 连接池 | 自己写 thread pool | `sql.DB` 自带 + `SetMaxOpenConns` | 连接池是 `DB` 的默认行为 |
| 查询单行 | `sqlite3_step` + 手动取列 | `db.QueryRow(...).Scan(&v)` | Scan 一次到位 |
| 查询多行 | 每列手动转换 | `rows.Next()` + `rows.Scan` | 循环+Scan，模板化 |
| 预处理 | `sqlite3_prepare_v2` | `db.Prepare` + `stmt.Exec` | 语义一致，但事务内惯用 tx 级 prepare |
| 事务 | `BEGIN/COMMIT/ROLLBACK` | `db.Begin()` + `tx.Commit/Rollback` | 要 `defer tx.Rollback()` 做兜底 |
| 结构体映射 | 手写行→struct 拷贝 | sqlx `Get`/`Select` 自动映射 | tag `db:"col"` 声明式 |
| ORM | 手写/第三方（如 sqlpp11） | GORM（AutoMigrate/关联） | 自动建表、crud、迁移 |
| 错误处理 | 返回码 | `err != nil` 全链路 | 每步都要查 | 

---

## 三、逐主题详解

### 3.1 database/sql 起步 —— Open 与连接池

`sql.Open` 并不会真的连数据库（`Ping` 才触发真实连接），它返回的 `*sql.DB` 是一个**连接池句柄**：

```go
package main

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/go-sql-driver/mysql" // 空导入：注册驱动，只用它的副作用
)

func main() {
	// 连接串格式随驱动：mysql 是 user:pass@tcp(host:port)/db?parseTime=true
	dsn := "root:123456@tcp(127.0.0.1:3306)/app?parseTime=true&charset=utf8mb4"
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err) // 注意：这里通常不会失败（Open 不连网）
	}
	defer db.Close() // Close 关闭句柄（不是立刻断开池里连接）

	// 关键：验证真的能连上，并配置连接池
	if err := db.Ping(); err != nil {
		log.Fatalf("连不上数据库: %v", err)
	}

	// 连接池参数（必须显式调优）
	db.SetMaxOpenConns(10)                // 同一时刻最多 10 个连接
	db.SetMaxIdleConns(5)                 // 空闲池保留 5 个
	db.SetConnMaxLifetime(time.Hour)      // 单连接最长活 1 小时，防 IP 切换/内存泄漏

	fmt.Println("数据库连接 OK")
}
```

> **C++ 对照**：`sql.Open` 的抽象约等于「一个懒初始化的连接池对象」。C++ 的 sqlite3 是单连接单线程，libpq 要自己管理 connection pool；Go 的 `sql.DB` 天生就是池，并发安全，直接多个 goroutine 共用同一个 `db` 即可。

连接池的三个 `Set*` 必须考虑：

| 方法 | 含义 | 需要调大的场景 |
|------|------|----------------|
| `SetMaxOpenConns` | 最大打开连接数 | 并发高时，别让它 0（无限）打爆数据库 |
| `SetMaxIdleConns` | 最大空闲连接数 | 短连接频繁时，减少重建 |
| `SetConnMaxLifetime` | 单连接存活时长 | 有 NAT/防火墙、或依赖数据库端参数 |

### 3.2 单行查询 QueryRow

```go
type User struct {
	ID   int
	Name string
	Age  int
}

func getUserByID(db *sql.DB, id int) (*User, error) {
	var u User
	// QueryRow 只查一行；.Scan 严格按参数顺序取列
	err := db.QueryRow("SELECT id, name, age FROM users WHERE id = ?", id).
		Scan(&u.ID, &u.Name, &u.Age)
	if err == sql.ErrNoRows { // 没查到是「有意义的错误」，单独处理
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}
```

> ⚠️ `ErrNoRows` 以后：`Scan` 会把 `err == sql.ErrNoRows` 返回。别用 `err != nil` 一把抓——「空结果」常常不是错误，要单独分支处理。

### 3.3 多行查询 —— 游标式遍历

```go
func listUsers(db *sql.DB) ([]User, error) {
	rows, err := db.Query("SELECT id, name, age FROM users ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close() // 循环结束后必须释放

	var users []User
	for rows.Next() { // 游标逐行前进
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.Age); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	// 遍历完记得检查迭代错误（连接中途断掉等）
	return users, rows.Err()
}
```

> **C++ 对照**：`rows.Next()` + `Scan` 很像 `sqlite3_step` + `sqlite3_column_*` 循环，但 `Scan` 帮你把 C 类型转成 Go 类型（NULL → nil、[]byte → string、time 解析），少写一半样板。

### 3.4 增删改与 Prepare 预处理

```go
// 单条 Exec
func insertUser(db *sql.DB, name string, age int) (int64, error) {
	res, err := db.Exec("INSERT INTO users(name, age) VALUES(?, ?)", name, age)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId() // 自增主键
	return id, err
}

// 批量插入用 Prepare：只解析一次 SQL，重复执行
func batchInsert(db *sql.DB, names []string) error {
	stmt, err := db.Prepare("INSERT INTO users(name) VALUES(?)")
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, n := range names {
		if _, err := stmt.Exec(n); err != nil {
			return err
		}
	}
	return nil
}
```

> `db.Prepare` 与 `tx.Prepare` 的区别：事务内用 **tx 级 prepare**，预编译语句跟着事务走，保证在同一个事务上下文里执行（见 3.5）。驱动程序层次上 Prepare 不一定真正走数据库端预编译，但**占位符防注入**是实打实的——永远不要拼接 SQL 字符串。

### 3.5 事务 Tx

Go 的事务模式是固定的三段模板：

```go
func transfer(db *sql.DB, fromID, toID, amount int) error {
	// 1. 开启事务
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	// 2. 兜底回滚：正常 Commit 后，Rollback 是 no-op（不产生副作用）
	defer tx.Rollback()

	// 3. 所有操作走 tx
	if _, err := tx.Exec("UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, fromID); err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, toID); err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE accounts SET version = version + 1 WHERE id = ?", fromID); err != nil {
		return err
	}

	// 4. 提交
	return tx.Commit()
}
```

**为什么 `defer tx.Rollback()` 这么写是安全的**：提交成功后调 Rollback 无副作用，Go 官方文档明确背书；一旦中途任一步出错 return，defer 即回滚。这个模式让事务代码不需要显式 try/catch——`err` 即控制流。

> **C++ 对照**：C++ 事务要么手动 `BEGIN/COMMIT/ROLLBACK` 三步曲，要么 RAII 包装类析构回滚；Go 的 `defer tx.Rollback()` 就是「RAII 的 Go 版本」，不够优雅但足够可靠。

### 3.6 sqlx —— 便捷的结构体映射

sqlx 不改变 database/sql，只是把「Result 结构体 + db tag」的映射做成了内置能力：

```bash
go get github.com/jmoiron/sqlx
```

```go
package main

import (
	"fmt"
	"log"

	"github.com/jmoiron/sqlx"
	_ "github.com/go-sql-driver/mysql"
)

type User struct {
	ID   int    `db:"id"`
	Name string `db:"name"`
	Age  int    `db:"age"`
}

func main() {
	db := sqlx.MustConnect("mysql", "root:123456@tcp(127.0.0.1:3306)/app?parseTime=true")
	defer db.Close()

	// 多行 → Select（slice 由 sqlx 自动填充）
	var users []User
	if err := db.Select(&users, "SELECT id, name, age FROM users WHERE age > ?", 18); err != nil {
		log.Fatal(err)
	}
	fmt.Println(users)

	// 单行 → Get
	var u User
	if err := db.Get(&u, "SELECT * FROM users WHERE id = ?", 1); err != nil {
		log.Fatal(err)
	}
	fmt.Println(u)

	// Named 查询：用结构体/ map 字段名代替占位符 ?，参数映射进 SQL
	// 注意 Named 语法是 :name 而不是 ?
	rows, err := db.NamedQuery(
		"SELECT * FROM users WHERE name = :name",
		map[string]any{"name": "Tom"},
	)
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		row := struct{ ID int `db:"id"` }{}
		if err := rows.StructScan(&row); err != nil {
			log.Fatal(err)
		}
		fmt.Println(row)
	}
}
```

sqlx 胜在 **`db` tag + `StructScan`**：查询结果列名直接映射结构体字段，`IN (...)` 展开、Named 传参等也都内置。**何时用 sqlx**：服务已经用 `database/sql` 手写了第一版、想要映射便利又不想引入完整 ORM 时，sqlx 是零负担升级。

### 3.7 gorm —— 全功能 ORM

gorm 提供自动建表（AutoMigrate）、模型驱动的 CRUD、事务、关联：

```bash
go get gorm.io/gorm gorm.io/driver/sqlite   # 或 gorm.io/driver/mysql 等
```

```go
package main

import (
	"fmt"
	"log"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 模型 = 结构体 + tag；AutoMigrate 会照此自动建表
type User struct {
	gorm.Model           // 内嵌：ID、CreatedAt、UpdatedAt、DeletedAt 自动字段
	Name  string         `gorm:"size:255;not null"`
	Email string         `gorm:"uniqueIndex"`
	Age   int            `gorm:"default:0"`
}

type Profile struct {
	ID     uint
	UserID uint   // 外键
	Bio    string
}

type Order struct {
	ID      uint
	UserID  uint
	Total   float64
	Items   []OrderItem `gorm:"foreignKey:OrderID"`
}

type OrderItem struct {
	ID      uint
	OrderID uint
	Name    string
	Price   float64
}

func main() {
	db, err := gorm.Open(sqlite.Open("app.db"), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}
	// 自动迁移：按模型建表/补列（框架管理运维便利，生产谨慎用）
	if err := db.AutoMigrate(&User{}, &Profile{}, &Order{}, &OrderItem{}); err != nil {
		log.Fatal(err)
	}

	// --- Create ---
	u := User{Name: "Tom", Email: "tom@example.com", Age: 30}
	if err := db.Create(&u).Error; err != nil { // u.ID 会被回填
		log.Fatal(err)
	}
	fmt.Println("新建用户 ID:", u.ID)

	// --- Read ---
	var first User
	db.First(&first, u.ID)              // 按主键
	db.First(&first, "name = ?", "Tom") // 条件
	var all []User
	db.Order("age desc").Limit(10).Find(&all) // 列表

	// --- Update ---
	db.Model(&first).Update("Age", 31)
	db.Model(&first).Updates(map[string]any{"Age": 32, "Name": "Tommy"})

	// --- Delete（软删除：gorm.Model 自带 DeletedAt，Delete 是标记删除） ---
	db.Delete(&first)

	// --- 事务 -------------------------------------------------------------
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&Order{Total: 99.9, Items: []OrderItem{{Name: "书", Price: 99.9}}}).Error; err != nil {
			return err // 返回 error 即回滚
		}
		if err := tx.Create(&Order{Total: 0}).Error; err != nil {
			return err
		}
		return nil // nil 即提交
	})
	if err != nil {
		log.Fatal(err)
	}

	// --- 关联：Preload 预加载 has-many ---
	var orders []Order
	db.Preload("Items").Find(&orders)
	fmt.Printf("共 %d 个订单，第一个含 %d 条明细\n", len(orders), len(orders[0].Items))
}
```

gorm 的生产使用注意：

- `AutoMigrate` 顺手但**变更表结构是有 DBA 纪律的**，生产环境建议只在开发/小项目用；大表迁移走专门工具；
- `gorm.Model` 自带软删除（`DeletedAt`），`Delete` 实际是 `UPDATE ... SET deleted_at`，`Find` 默认过滤已删行；
- 关联用 tag `foreignKey` 声明，查询时 `Preload` 控制预加载，能有效避免 N+1（对比 C++ 里手写 join 或 SQL 拼胶水）。

> **C++ 对照**：gorm ≈ sqlpp11 / ODB（C++ ORM），但 gorm 的 AutoMigrate + 关联 Preload 体验更像框架级「电池全含」。C++ 侧通常手写 SQL + 手动映射更可控；Go 侧 gorm 一步到位。

### 3.8 「换驱动不改代码」—— database/sql 的通用性

database/sql 最大的价值：**业务代码只依赖抽象层，数据库由驱动决定**。驱动库的职责仅两件事——注册名字、实现接口：

```go
// MySQL：空导入一行即可切换
import _ "github.com/go-sql-driver/mysql"

// PostgreSQL：只换驱动与连接串
import _ "github.com/lib/pq"
// dsn = "host=localhost user=postgres password=x dbname=app sslmode=disable"
// 占位符从 ? 换成 $1、$2 ...

// SQLite：用于本地/测试
import _ "modernc.org/sqlite" // 纯 Go 实现，无 CGO
// dsn = "file:app.db"

// 达梦 DM8：官方/社区提供 Go 驱动，同样注册进 database/sql
import _ "dm" // 例：github.com/gentleming/dm 等
// dsn = "dm://SYSDBA:123456@localhost:5236?schema=APP"
```

**你在 Database 区学的达梦（DM8）恰好是同一个套路**：Go 生态对国产库的支持走的就是 SQL 标准 + database/sql 驱动这条路。用 `database/sql`（或 sqlx）写的查询代码，只要避免方言特性、用通用占位符习惯（`?`），从 MySQL 切到达梦在**代码层面基本不改**——改的是驱动 import、连接串、以及个别 SQL 方言（分页、序列、自增写法）。这也解释了为什么 `database/sql` 在 Go 里地位这么高：它保证了「数据库是插件」。

> ⚠️ 但「不改代码」不等于「零改动」：占位符（`?` vs `$N`）、自增返回（`LastInsertId` 在某些库不支持）、分页语法因库而异。切换前用 `db.Ping()` + 一组 smoke 测试验证，别一股脑切换。

---

## 四、常见坑与误区

### 坑 1：`sql.Open` 成功≠连上了数据库

- **现象**：Open 后没报错，一查询就挂；或服务已起但数据库还没就绪。
- **原因**：Open 只创建池，不建立真实连接；真实连接在首次查询/Ping 才发生。
- **正确写法**：启动后立刻 `db.Ping()`（或 `PingContext`），失败就 fail-fast。

### 坑 2：拿到 `rows` 忘了 Close

- **现象**：长时间运行后连接耗尽，`database/sql: connection pool exhausted`。
- **原因**：`rows.Next()` 结束时底层连接没释放归还；`for rows.Next()` 中途 return 更会漏。
- **正确写法**：`rows, err := db.Query(...)` 后**紧跟** `defer rows.Close()`；最好显示校验 `rows.Err()`。

### 坑 3：占位符写错（`?` vs `$1`）

- **现象**：切 PostgreSQL 后 SQL 全部报语法错。
- **原因**：占位符是驱动方言的一部分，不是标准库规定。
- **正确写法**：MySQL/SQLite/DM 多用 `?`；PostgreSQL/Oracle 用 `$1`/`:param`；跨库代码把 SQL 抽成常量并在文档标注方言。

### 坑 4：`sql.ErrNoRows` 被当普通错误处理

- **现象**：`QueryRow().Scan()` 没查到就返回 error，上层 log 刷屏「no rows」。
- **原因**：空结果是**业务语义**，不是系统错误；但 Scan 把它编码成错误返回。
- **正确写法**：`if errors.Is(err, sql.ErrNoRows) { /* 空结果分支 */ }`，再进入真正错误分支。

### 坑 5：事务忘记 `defer tx.Rollback()`

- **现象**：某分支提前 return 时连接被占、脏事务挂着，后续操作全卡在锁上。
- **原因**：Commit 前中断没回滚，事务句柄泄漏。
- **正确写法**：`tx, _ := db.Begin()` 后立刻 `defer tx.Rollback()`，Commit 成功后该 defer 自动变 no-op。

### 坑 6：连接池参数完全没调

- **现象**：突发流量把数据库打挂；或空闲时一堆连接占着 MySQL `max_connections`。
- **原因**：默认池无上限/无限空闲。
- **正确写法**：`SetMaxOpenConns` + `SetMaxIdleConns` + `SetConnMaxLifetime` 三件套显式配齐，数值按并发预期与数据库规格来。

### 坑 7：用字符串拼接 SQL 而不是占位符

- **现象**：用户输入含引号时 SQL 语法爆炸，甚至被 `' OR 1=1` 注入。
- **原因**：`fmt.Sprintf("SELECT * FROM u WHERE name='%s'", name)` 直接拼进 SQL。
- **正确写法**：永远是 `WHERE name = ?` + 参数传值；需要动态拼「可变的列名/表名」时，用白名单校验（不允许直接拼用户输入）。

### 坑 8：gorm 里无脑 `AutoMigrate` 上生产

- **现象**：大版本迭代忘跑迁移，线上表结构错过变更直接 panic；或 AutoMigrate 把不该删的索引动了。
- **原因**：把表结构变更当成「框架顺手」的决定，缺少评审。
- **正确写法**：开发期可 AutoMigrate 全量；生产用显式迁移脚本（golang-migrate 等），配合 CI 评审后执行。

---

## 五、练习任务

- [ ] 用 `database/sql` + MySQL 驱动连本机库，写 `getUserByID` 并验证 `ErrNoRows` 分支
- [ ] 实现 `transfer` 事务模板（`defer tx.Rollback()` + Commit），测试中途出错回滚
- [ ] 用 `db.Prepare` 批量插入 1000 行，对比不用 Prepare 逐条 Exec 的耗时
- [ ] 用 sqlx 的 `db:` tag 写 `Select`/`Get`，再用 `NamedQuery` 跑一次 `IN (:ids)` 查询
- [ ] 用 gorm 建 `User`/`Profile` 模型，AutoMigrate 后 CRUD 各跑一遍，`Preload` 拉关联
- [ ] **对照 C++ 重写**：把之前用 sqlite3 / libpq（或 sqlpp11）写的一个小 DAO 封装，用 database/sql + sqlx 重写，对比连接池与错误处理
- [ ] 用 `db.Ping` + 一组 smoke SQL，写一个「从 MySQL 切到 SQLite（modernc.org/sqlite）不改业务代码」的演示，记录哪些字符要改

---

## 六、延伸与参考

- database/sql 官方文档：<https://pkg.go.dev/database/sql>
- 官方博文《Go database/sql tutorial》(连接池/ErrNoRows/Prepare 的权威指南)：<https://go.dev/doc/database/>
- sqlx 仓库：<https://github.com/jmoiron/sqlx>
- GORM 官方文档：<https://gorm.io/docs/>（含关联、事务、迁移）
- golang-migrate（迁移工具）：<https://github.com/golang-migrate/migrate>
- 相关笔记：[[03-Web框架-Gin-Echo]] · [[05-综合项目实战记录]] · [[02-错误处理-error-panic-recover]] · [[05-encoding-json与配置文件]]