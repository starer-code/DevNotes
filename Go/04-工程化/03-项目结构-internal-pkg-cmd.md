# 03 - 项目结构 internal/pkg/cmd

> 从 C++ 的目录与命名空间组织到 Go 的「包即边界」：cmd/internal/pkg 是社区事实标准

---

## 一、简述

Go 没有 C++ 头文件/源文件对，也没有 C++ 那种「目录 + 命名空间」两级组织。Go 的组织单位是**包（package）**，一个目录一个包，`import` 路径即模块路径 + 目录路径。一个可发布的 Go 项目结构，社区多年沉淀出了事实标准：

```
<repo>
├── cmd/        # 可执行程序入口（main 包）
├── internal/   # 私有代码：仅本项目可导入
├── pkg/        # 可复用库代码：对外公开
├── configs/    # 配置文件
├── scripts/    # 构建/运维脚本
└── go.mod
```

更向上看，Go 的哲学是 **「包即层级」**：包之间靠 import 建立依赖，import 循环会被编译器直接拒绝——比 C++ 的循环 include 报错更早、更严格。这天然强制了「按层依赖」的架构。

> **核心要点**：`cmd` / `internal` / `pkg` 不是语言强制，而是 golang-standards/project-layout 提出的**事实约定**。真正由 Go 强制的是：`internal` 的可见性规则、每个 `main` 包是入口、包不能循环导入。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 组织单位 | 命名空间（namespace）+ 头文件 | 包（package） | 目录=包=导入路径，三合一 |
| 入口 | `int main()` | `package main` + `func main()` | main 包即程序入口 |
| 公共接口 | `namespace Foo` 内公开符号 | 大写导出 / 小写私有 | 可见性跟**标识符首字母**走 |
| 私有代码 | pimpl / 内部命名空间 / 隐藏符号 | `internal/` 目录 | 语言级可见性守卫 |
| 循环依赖 | 前置声明 + 复杂 include 图 | **编译器拒绝** | 包循环导入即编译错误 |
| 头文件 | `.h` 声明 + `.cpp` 实现 | 一个 `.go` 文件即包的一段 | 无头文件，声名即定义 |
| 分层 | module/backend/… 手工约定 | handler→service→repository | 由 import 依赖方向强制 |
| 单一大包 | 一个巨型头文件库 | 拆小而聚焦的包 | Go 鼓励多包、小接口 |
| 测试辅助 | 测试私有符号靠 friend/内部类 | `internal` 包可见 | 测试可直接放同包访问私有函数 |

---

## 三、逐主题详解

### 3.1 标准布局总览：cmd / internal / pkg

以 golang-standards/project-layout 为参考的常见布局：

```
myapp/
├── cmd/
│   └── server/
│       ├── main.go        # 程序入口：解析参数/装配依赖/启动
│       └── main_test.go
├── internal/
│   ├── config/            # 内部配置加载
│   ├── handler/           # HTTP handler 层（路由→处理）
│   ├── service/           # 业务逻辑层
│   └── repository/        # 数据访问层（DB/外部 API）
├── pkg/
│   └── httputil/          # 对外可复用的通用工具
├── configs/               # 配置文件（非 .go）
├── docs/                  # 文档
├── scripts/               # 脚本
├── .gitignore
└── go.mod
```

| 目录 | 用途 | C++ 对应其分 |
|------|------|--------------|
| `cmd/<name>/` | 每个子目录是一个可执行程序的 main 包 | 有 `main()` 的多个可执行目标（CMake `add_executable`） |
| `internal/` | 私有代码；**外部 import 直接报错** | `detail` 命名空间 / pimpl / 不导出的符号 |
| `pkg/` | 对外公开、可被他人 import 的库 | 安装的 `.h` + `.a/.so` |
| `configs/` | 配置文件（yaml/json 样例） | `configs/` 或安装回填的配置 |

> ⚠️ **internal 是唯一语言强制的**：目录名是 `internal`，Go 编译器自动限制——只有「同一根路径下」的包能导入它。比如 `internal/config` 只能被 `myapp` 下其他包导入，`github.com/other/xxx` 想 import 会在编译期报：
>
> `use of internal package myapp/internal/config not allowed`

### 3.2 cmd/：入口只做装配

`cmd/server/main.go` 应该**极薄**——只有参数解析、依赖装配、启动：

```go
// cmd/server/main.go
package main

import (
    "log"
    "os"

    "myapp/internal/config"
    "myapp/internal/server"
)

func main() {
    // 1. 配置
    cfg, err := config.Load("configs/app.yaml")
    if err != nil {
        log.Fatalf("加载配置失败: %v", err)
    }

    // 2. 装配（依赖注入：把 repository/service 串起来）
    srv := server.New(cfg)

    // 3. 启动（阻塞监听）
    if err := srv.Run(); err != nil {
        log.Fatalf("服务异常退出: %v", err)
    }
    // 所有 os.Args 处理都在这一层，业务包不碰全局状态
    _ = os.Args
}
```

> **C++ 对照**：等价于 `main.cpp` 只做 `App app; app.run(argc, argv);`。业务逻辑绝不写在 main 里，奥义是**入口职责最小化**、便于用 `_test` 包替身做集成测试。

### 3.3 internal/：私有代码的语言级守卫

`internal` 之外，还有**包内层次**：`internal/handler → internal/service → internal/repository`。

```go
// internal/repository/user.go —— 数据访问层，只论存取，不聊业务
package repository

type User struct {
    ID   int64
    Name string
}

// 该层只管 SQL/ORM/缓存，返回值是领域对象
func (r *UserRepo) FindByID(id int64) (*User, error) {
    // 假设底层是 database/sql
    row := r.db.QueryRow("SELECT id, name FROM users WHERE id = ?", id)
    var u User
    if err := row.Scan(&u.ID, &u.Name); err != nil {
        return nil, err
    }
    return &u, nil
}
```

```go
// internal/service/user.go —— 业务层，规则都在这里
package service

type UserService struct {
    repo *repository.UserRepo // 依赖倒置：面向接口更优雅
}

func (s *UserService) GetDisplayName(id int64) (string, error) {
    u, err := s.repo.FindByID(id) // 调用下层
    if err != nil {
        return "", err
    }
    // 业务规则：空名字给默认值
    if u.Name == "" {
        return "匿名用户", nil
    }
    return u.Name, nil
}
```

```go
// internal/handler/user.go —— 运输层：HTTP → 业务对象 → HTTP
package handler

func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")
    // 解析参数
    // 调 service
    // 写响应
}
```

依赖方向 **handler → service → repository**，只允许「上层 import 下层」，反方向会立刻触发循环导入编译错误。

> **C++ 对照**：这套三层分层与 C++ 后端（Controller/Service/Dao）同构。差异在**边界是谁在强制**：C++ 靠 review/纪律和小心管理 include 图；Go 靠编译器 + internal 守卫，错了根本编译不过。

### 3.4 pkg/：对外公开的可复用代码

`pkg/` 放**愿意开源给别人用**的通用能力。它和 `internal/` 的分界线是心态：

```go
// pkg/httputil/response.go —— 对外库：JSON 统一响应
package httputil

func WriteJSON(w http.ResponseWriter, status int, data any) {
    w.Header().Set("Content-Type", "application/json; charset=utf-8")
    w.WriteHeader(status)
    _ = json.NewEncoder(w).Encode(data)
}
```

什么时候该用 `pkg/`？两派观点：

- 保守派：**一律 internal**，等真的有外部调用方再拆到 pkg。
- 开放派：通用、无业务上下文（时间格式化、响应工具）直接 `pkg/`。

> ⚠️ Go 官方历史上有建议**不建 pkg 目录**（把公开库直接放根目录/独立子模块）的声音。最稳妥共识：**默认 internal**，公开是刻意决定、不是默认值——这跟 C++ 头文件「默认公开一切」相反。

### 3.5 小规模项目可以简化

微型项目/脚本级工具**不是所有目录都要有**：

```
hello/            # 直接放根（或 cmd/ 替代）
├── main.go
├── util.go       # 同包内部拆分文件即可
├── util_test.go
└── go.mod
```

一个 500 行的工具，硬套 cmd/internal/pkg 属于过度设计——Go 自己很多官方工具也是单目录多个 `.go` 文件+`main.go`。**是否分层看规模与可测性需求**。

> **C++ 对照**：对应「单文件 main.cpp + 几个 .h 的工具」vs「企业级多模块 build」的同一决策点：别为小型程序过早引入工程骨架。

### 3.6 包即层级：package 的命名与组织

- **一个目录一个包**：目录名最好等于包名（小写、无下划线，`syncthing` 除外）
- **包名短**：`service`、`cache`、`store`，因为调用处常年写 `service.Get(...)`
- **文件名多 + 包少**：一个大包拆多个 `.go` 文件（`user.go`、`order.go` 同属 `package store`）
- **工具函数**：`util`/`common` 包容易腐化成垃圾桶——**宁可拆到语义清晰的包**

```go
// 合理：按领域拆包
import (
    "myapp/internal/cache"   // Redis 封装
    "myapp/internal/store"   // 关系库封装
)

// 避免：垃圾桶式 common
// import "myapp/internal/common"  // 什么都往里塞的隐患
```

### 3.7 Go 生态的 import 路径与可见性小结

| 规则 | 说明 | C++ 对应 |
|------|------|----------|
| 导出 = 大写首字母 | `User`、`New`、`WriteJSON` 可被外部用 | `public:` 符号 |
| 私有 = 小写首字母 | `user`、`new`、`writeJSON` 包内可见 | `private:` / 匿名 namespace |
| `internal/` | 限制到模块内部 | DLL 隐藏符号 / 不安装头文件 |
| `_test.go` | 同包可访问私有成员 | C++ friend test / 白盒测试 |
| 循环 import | 编译错误 | 头文件循环 include（噩梦） |

### 3.8 一个仓库多个可执行程序：cmd 的威力

一个仓库可以出多个二进制——每个 `cmd/<name>/` 即一个 `main` 包：

```
myapp/
├── cmd/
│   ├── server/     # 对外服务
│   ├── worker/     # 后台任务消费者
│   └── cli/        # 命令行管理工具
└── internal/
    ├── service/    # 三者可共享的业务逻辑
    └── repository/
```

```go
// cmd/server/main.go 与 cmd/worker/main.go 各自 import internal/service
// 入口薄、共享多：cmile/server 和 worker 装配方式不同，但核心逻辑一份
package main

import (
    "myapp/internal/config"
    "myapp/internal/service"
)

func main() {
    cfg := config.FromEnv()
    _ = service.NewOrderService(cfg) // 共享的业务核心
    // ... 不同入口做不同的装配
}
```

这对应 C++ 的「一个 CMake 工程出多个 target（可执行 + 静态库）」，但 Go 天然共享 internal 私有代码——C++ 里这些共享代码得先做成 `add_library` 才能被各 target 引用。

### 3.9 辅助目录：configs / scripts / docs / testdata

| 目录 | 内容 | 注意事项 |
|------|------|----------|
| `configs/` | 配置文件（yaml/json 样例、环境变量模板） | 不要把真实密钥提交 |
| `scripts/` | 构建/发布脚本（build.sh、migrate.sh） | 跨平台注意换行；可用 ci 脚本替代 |
| `docs/` | 设计文档、API 文档 | 与 `go doc` 注解互补 |
| `testdata/` | 测试数据文件 | **目录名固定**，`go test` 会把它看作给定服务 |
| `assets/` | 静态资源（模板/前端产物） | 用 `go:embed` 打入二进制 |

其中 `testdata` 有特殊语义：**名字就叫 `testdata` 的目录不会被编译器当包编译**，放任意数据文件安全：

```go
// 测试里这样引用 testdata 下的文件
func TestLoadFixture(t *testing.T) {
    data, err := os.ReadFile("testdata/order_sample.json")
    // ...
}
```

### 3.10 从零到一：一个完整的小型分层项目

把前面散点串起来，一个「订单服务」的完整骨架（可直接照抄练习）：

```
order-app/
├── go.mod                         # module order-app
├── cmd/server/main.go             # 入口：装配与启动
├── internal/
│   ├── config/config.go           # 读环境变量/配置
│   ├── model/order.go             # 领域对象
│   ├── repository/order_repo.go   # 内存/DB 存取
│   ├── service/order_service.go   # 业务规则
│   └── handler/order_handler.go   # HTTP 传输层
└── pkg/stringutil/slug.go         # 可复用（可选公开）
```

```go
// internal/model/order.go —— 领域对象
package model

type OrderStatus string

const (
	StatusPending  OrderStatus = "pending"
	StatusShipped  OrderStatus = "shipped"
)

type Order struct {
	ID     int64
	Amount float64
	Status OrderStatus
}
```

```go
// internal/repository/order_repo.go —— 数据层（先内存实现）
package repository

import "order-app/internal/model"

type OrderRepo struct {
	store map[int64]*model.Order
	seq   int64
}

func (r *OrderRepo) Save(o *model.Order) {
	r.seq++
	o.ID = r.seq
	r.store[o.ID] = o
}
```

```go
// internal/service/order_service.go —— 业务层
package service

func (s *OrderService) Place(amount float64) (*model.Order, error) {
	if amount <= 0 {
		return nil, errors.New("金额必须为正")   // 业务规则在此
	}
	o := &model.Order{Amount: amount, Status: model.StatusPending}
	s.repo.Save(o)
	return o, nil
}
```

```go
// internal/handler/order_handler.go —— 传输层
package handler

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
	// 1. 解析 body
	// 2. 调 service.Place
	// 3. httputil 写 JSON
}
```

> ⚠️ **分层即职责**：repository 不知道「金额要为负判断」，handler 不知道「订单状态迁移」——职责错位会立刻体现为 import 方向混乱。对照 C++ data member / 方法组织，Go 把「谁在什么层」写进了目录名。

### 3.11 依赖方向图（架构自检）

写完后用 `go list` 验证依赖方向没有反转：

```bash
# 谁的包依赖了谁（-f 输出 import 到的本仓库包）
go list -deps ./internal/... | grep order-app

# 或直接人工检查：internal/handler 只 import internal/service、model、pkg
```

满足「上层 import 下层、单向无环」即达标；一旦 `internal/service` import 了 `internal/handler`，编译直接报循环——这是 Go 每天帮你守着架构纪律的体现。

---

## 四、常见坑与误区

### 坑 1：把所有代码堆进一个大 package main

- **现象**：一个 main.go 两千行，功能、数据访问、HTTP 路由全在一个包里。
- **原因**：C++ 习惯「一个 cpp 就是一块功能」，但 Go 的包是可跨文件组合的。
- **正确写法**：业务逻辑拆包（`internal/service` 等），main 只做装配；`.go` 文件按职责拆，别按「是不是同一个 main」判断。

### 坑 2：内部包想公开，直接在外层建目录

- **现象**：命令/模块多了后，外部用户能 import 到内部实现细节。
- **原因**：没有 `internal` 标识的目录在模块内默认全公开。
- **正确写法**：只要「本模块私有」，一律放 `internal/` 下；真想公开再迁到 `pkg/`。

### 坑 3：import 循环，编译器报错但仍硬拆

- **现象**：`service` 依赖 `repository`，`repository` 又想调 `service` 的某个函数 → 编译报 cycle。
- **原因**：双向依赖往往是「分层不清」的信号。
- **正确写法**：把共享对象提到第三层（如 `internal/model`）或声明接口让某侧反转依赖（service 持 interface，repository 实现它）。

### 坑 4：internal 位置放错，导致测试/子命令无法访问

- **现象**：`cmd/` 下的工具想 `import myapp/internal/x`，发现可以；但换一个同仓库独立模块（如 `tools/` 独立 go.mod）就报 not allowed。
- **原因**：`internal` 的可见范围是**「同一模块根路径」**，拆成多个 go.mod/模块后边界失效。
- **正确写法**：同仓库保持单模块顶层结构；确需多模块时，共享逻辑放独立公共模块的 `pkg/`。

### 坑 5：`util`/`common` 包无脑膨胀

- **现象**：common 包最终装了几百个不相关函数，谁都在 import。
- **原因**：C++ 习惯建「公共工具」，但 Go 的 import 路径即文档，语无伦次的包名破坏可读性。
- **正确写法**：按语义拆小包（`strslice`、`httputil`、`mytime`），一个包只干一件事；包名要能预测内容。

### 坑 6：模型/实体层互相引用造成循环

- **现象**：`handler` 里的 `req` 结构、`service` 里的 `User`、`repository` 里的 DTO 各自重复定义。
- **原因**：传统 C++ DTO 分层里各层自己的类型，翻译到 Go 时没有收敛。
- **正确写法**：轻量情形可共享 `internal/model` 的领域结构；重量系统可让各层定义自己的 DTO 并在 service 边界做转换（取舍题，没有唯一答案）。

### 坑 7：把 main 包当「唯一包」，`go test ./...` 覆盖不到业务

- **现象**：很多逻辑在 main 里，测试只能测 main 包，import 不进来。
- **原因**：main 包不便于被其他包 import，天然难搭被测。
- **正确写法**：业务逻辑下沉到 internal 包（可测），main 保持装配 —— 这就是 cmd/internal 分层直接的工程收益。

---

## 五、练习任务

- [ ] 把一个「单文件 go 脚本」重构为标准布局：`cmd/server/main.go` + `internal/service` + `internal/repository`（repository 先用内存 map 实现）
- [ ] 在 `internal/handler` 写一个 handler，在 `internal/service` 写业务规则，手工触发一次 import cycle 观察编译报错，再用接口反转依赖修复
- [ ] 写一个 `pkg/httputil` 并写单元测试，体会它是「刻意公开」的
- [ ] 对照 C++ 的实践：把你 C++ 项目的 `Controller/Service/Dao` 三层结构翻译成 Go 的 `internal/{handler,service,repository}`，画出 import 依赖方向图
- [ ] 在小项目里故意把不该公开的包放到根目录，构造一次「外部模块 import internal 被拒」的复现实验
- [ ] 阅读 golang-standards/project-layout 的 README，挑 3 个你认为适合你项目的目录写进你自己的项目布局注释

---

## 六、延伸与参考

- 社区事实标准：[golang-standards/project-layout](https://github.com/golang-standards/project-layout)
- 官方博客：[Organizing Go code（较老但仍有参考价值）](https://go.dev/blog/organizing-go-code)
- 官方文档：[Package naming（Effective Go）](https://go.dev/doc/effective_go#package-names)
- 官方文档：[How to Write Go Code（gopath 时期的包组织思想）](https://go.dev/doc/code)

相关笔记：

- [[01-接口interface]] —— 面向接口的分层是 handler/service/repository 的基石
- [[02-测试-单元-表格驱动-基准-覆盖率]] —— internal 让测试与私有代码同包共生
- [[01-go-mod依赖管理]] —— go.mod 与 import 路径共同定义包的可见边界