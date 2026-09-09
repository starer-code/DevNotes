# 01 - go mod 依赖管理

> 从 C++ 的 CMake+Conan/vcpkg 到 Go modules：官方集成、语义化版本与可复现构建

---

## 一、简述

Go 自 1.11 起引入 **Go modules**（常称 `go mod`）作为官方依赖管理工具，1.16 起默认启用。它把「依赖管理」内置到工具链里，一个 `go.mod` 文件声明模块与依赖，`go.sum` 锁定依赖的校验和，配合**语义化版本（v1.2.3）**和 `GOPROXY` 代理，实现可复现构建。

对于 C++ 开发者，可以把它理解为「**CMake + Conan/vcpkg + 包清单 + 锁文件**的四合一」：`go.mod` ≈ `CMakeLists.txt` + `conanfile.txt`，`go.sum` ≈ 锁文件，`go get` ≈ `conan install`，`replace` 指令 ≈ CMake 的本地路径引入。

> **核心要点**：Go modules 不是「又一个包管理器」，而是**语言官方、零配置文件**的依赖解决方案。理解 `go.mod` 的四个指令（`module` / `go` / `require` / `replace`）就掌握了 90% 的日常操作。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 构建系统 | CMake / Makefile | `go build`（内建） | 无需写构建脚本 |
| 依赖清单 | `conanfile.txt` / `vcpkg.json` | `go.mod` | 官方格式，随项目同时维护 |
| 依赖安装 | `conan install` / `vcpkg install` | `go get` / `go mod tidy` | 不装到系统，进模块缓存 |
| 锁文件 | Conan `conan.lock`（可选） | `go.sum` | **默认生成**，锁定每行依赖版本+校验和 |
| 本地路径依赖 | `target_link_libraries` 指向源码目录 | `replace ... => ../xxx` | 官方一等公民指令 |
| 语义化版本 | Conan `[requires] pkg/1.2.3` | `v1.2.3`（标签含 `v` 前缀） | Go 的版本就是 git tag |
| 代理/镜像 | 自建 Artifactory / Nexus | `GOPROXY`（如 goproxy.cn） | 环境变量即可切换，无需配置仓库 |
| 私有仓库 | CMake `FetchContent` + SSH | `GOPRIVATE` + git | 绕过代理直连 |
| 缓存目录 | Conan 本地 cache | `$GOPATH/pkg/mod` | 全局共享，只读 |
| vendor 机制 | 把第三方源码拷进仓库 | `go mod vendor` | 可选但常用，利于离线构建 |

---

## 三、逐主题详解

### 3.1 module 与 go.mod 三大字段

在项目根目录运行 `go mod init` 生成 `go.mod`：

```bash
# 在项目根目录执行
go mod init myapp

# 也可以指定完整模块路径（通常是仓库地址，不含 .git）
go mod init github.com/starer-code/myapp
```

生成的 `go.mod` 文件包含两个基础字段：

```go
// 第 1 行，极重要
module github.com/starer-code/myapp

go 1.22

// 后续由 go get/go mod tidy 自动追加
require (
    github.com/gin-gonic/gin v1.9.1
    golang.org/x/text v0.14.0
)
```

| 字段 | 含义 | 类比 C++ |
|------|------|----------|
| `module` | 本模块的名字。几乎总是仓库地址，因为它决定**导入路径** | 像命名空间/包名，但全局唯一 |
| `go` | 项目要求的 Go **最低版本** | 像指定编译器最低标准 |
| `require` | 直接依赖及其版本 | 像 CMake `find_package` + conan `[requires]` |

> **C++ 对照**：`module` 行不是可有可无的元数据——它决定别人 `import` 你的包时用什么路径。`require` 里的间接依赖（传递依赖）由 `go mod tidy` 自动补全，CMake 里你得手动 `find_package` 每一个。

### 3.2 go mod 常用子命令

| 命令 | 作用 |
|------|------|
| `go mod init <path>` | 初始化模块，生成 go.mod |
| `go mod tidy` | **自动增删依赖**：加代码里需要的、删没用的，并更新 go.sum |
| `go mod download` | 下载 go.mod 里列出的全部依赖到本地缓存 |
| `go mod vendor` | 把依赖源码复制到项目 `vendor/` 目录 |
| `go mod graph` | 打印依赖关系图 |
| `go mod verify` | 校验本地缓存的依赖与 go.sum 一致 |
| `go list -m all` | 列出所有模块版本 |

**`go mod tidy` 是日常最高频命令**——写完代码里有新 import，或删了某段代码，运行它即可让 go.mod 与代码保持一致：

```bash
# 写完代码后，让依赖与代码对齐
go mod tidy
```

> ⚠️ **C++ 对照**：CMake 里新增一个第三方库要走「改 conanfile → conan install → 改 CMakeLists → 重新 configure」三步；Go 只要 `go get` 一次，`tidy` 可随时兜底清洗。**不要手写 go.mod 的 require**，让它自动维护。

### 3.3 版本语义：v1.2.3 与 module path

Go 依赖版本号直接取自仓库的 **git tag**，格式 `vX.Y.Z`：

- `v1.2.3` —— 正式版（与语义化版本一致）
- `v1.2.3-rc.1` / `v1.2.3-beta.1` —— 预发布
- `v0.1.0` —— 主版本为 0 时不稳定是常态
- `v1.2.3-20260101-abcdef123456` —— `go get` 指定 commit 时使用的伪版本（pseudo-version）

**module path 与版本强相关**：主流版本 `v1`、`v2`、`v3` 走不同的 import 路径：

```go
// v1 及以前：路径不带主版本号
import "github.com/user/project"

// v2 及以上：路径末尾必须带 /vN
// 所以必须用 go mod init github.com/user/project/v3
import "github.com/user/project/v3"
```

> **C++ 对照**：Conan/vcpkg 里 `pkg/2.0.0` 的包名不随版本变；Go 里升级到 v2 意味着 import 路径也变。这是 Go 为避免「同一依赖出现多份冲突实现」而设计的硬规则——**破坏性升级必须换路径，老用户不受影响**。

### 3.4 GOPROXY：官方代理与国内镜像

```bash
# 查看当前配置
go env GOPROXY

# 官方默认
#   https://proxy.golang.org,direct

# 国内常用（goproxy.cn，七牛云维护）
go env -w GOPROXY=https://goproxy.cn,direct

# 完全禁用代理（所有依赖走 git 直连）
go env -w GOPROXY=direct

# GOPROXY 也影响 module 校验与下载加速
```

`GOPROXY` 是逗号分隔列表：先尝试代理，`direct` 兜底直连 git。

> ⚠️ **C++ 对照**：C++ 的包源（Conan center / vcpkg registry / apt）通常要配置第三方源或公司源；Go 只需一个环境变量，`go env -w` 即可持久化。Windows 下默认写入 `%APPDATA%\go\env`。

### 3.5 go get 精确加版本

`go get` 用来添加/升级/降级依赖，是「改 go.mod + 下载」的组合命令。

```bash
# 默认：最新版本（自动更新 go.mod 与 go.sum）
go get github.com/gin-gonic/gin

# 指定版本：@v1.9.1
go get github.com/gin-gonic/gin@v1.9.1

# 升级到最新小版本（同主版本内）
go get -u github.com/gin-gonic/gin

# 升级所有直接依赖到最新小版本
go get -u ./...

# 指定 commit（会生成伪版本）
go get github.com/user/project@abcdef123456

# 指定分支最新提交
go get github.com/user/project@main
```

日常习惯：**优先锁定正式版本**（`@v1.9.1`），伪版本只用于临时修 bug 验证。

> **C++ 对照**：`go get pkg@v1.9.1` ≈ `conan install pkg/1.9.1@`。但 Go 升级依赖不会像 C++ 那样引发 ABI 兼容问题（二进制兼容由 Go 运行时 + 静态编译兜底），风险主要在 API 变化。

### 3.6 replace：本地替换

`replace` 在联调本地库、fork 改造、规避被墙仓库时是神器：

```go
// go.mod 中
module myapp

go 1.22

require (
    github.com/starer-code/mylib v0.0.0
)

// 把线上依赖替换为本地目录
replace github.com/starer-code/mylib => ../mylib

// 也可整体换版本
// replace github.com/starer-code/mylib => github.com/starer-code/mylib v1.1.0

// 也可换到指定 commit
// replace github.com/starer-code/mylib => github.com/starer-code/mylib v0.0.0-20260101-abcdef123
```

本地替换后无需每次 `go get`，直接 `go build` 就会用本地目录的最新代码——这正是 C++ 开发者的**热土习惯**。

> **C++ 对照**：`replace ... => ../mylib` 相当于 CMake 里 `add_subdirectory(../mylib)` + `target_link_libraries` 指源码，而不是链接安装好的 .so/.a。**注意**：`replace` 只在当前模块生效，不会被带进别人的依赖里。

### 3.7 私有仓库与 GOPRIVATE

公司内私有 Git 仓库既不在公共代理上，又可能涉及鉴权：

```bash
# 设置私有模块通配符：这些路径绕过代理，直接走 git
go env -w GOPRIVATE=github.com/mycompany/*,gitlab.mycompany.com

# GOPRIVATE 是 GONOSUMDB 与 GONOPROXY 的快捷方式
#   含义1：不查公共代理（直连 git）
#   含义2：不查询公共 checksum 数据库（生成自身 go.sum）
```

访问私有仓库的鉴权走 git 本身（SSH key 或 `~/.gitconfig` 里的 HTTPS 凭据），Go 不额外存储凭据。

> **C++ 对照**：相当于 CMake `FetchContent` 拉私有仓库时依赖 `.gitconfig` 的 SSH key。C++ 里私有包还要配私有 Conan remote；Go 里一条 `GOPRIVATE` 即可。

### 3.8 go.sum 与可复现构建

`go.sum` 记录每个依赖版本的**哈希校验**：

```
github.com/gin-gonic/gin v1.9.1 h1:...=(base64 hash)
github.com/gin-gonic/gin v1.9.1/go.mod h1:...=...
```

- `go mod tidy` 会自动维护它，无需手工编辑
- 目的：**任何机器/任何时间**拉到的依赖内容必须一致，防止依赖被篡改或版本漂移
- 首次引入依赖时，若该依赖不在公共 checksum 数据库（私有），需要 `GONOSUMCHECK`（早期）/ 现在靠 `GOPRIVATE` 规避

```bash
# 校验本地缓存的依赖与 go.sum 是否一致
go mod verify
```

> ⚠️ **C++ 对照**：`go.sum` 的地位 ≈ `conan.lock` + `CMakeCache.txt`，但**默认且强制**。C++ 很多项目根本不做哈希校验，供应链攻击风险更高；Go 的依赖哈希校验内置在 `go build` 流程里。

### 3.9 vendor：把依赖锁进仓库

企业内网/离线环境无法访问代理时，把依赖源码随仓库一起管理：

```bash
# 生成 vendor/ 目录（填充 go.mod 里所有依赖的源码）
go mod vendor

# 构建时强制使用 vendor/ 而不是缓存
go build -mod=vendor ./...
```

- 用 vendor 后，**Go 1.14+ 自动识别**存在 vendor 目录且 go.mod 的 go 版本 ≥1.14 时，默认用 vendor，无需 `-mod=vendor`
- vendor 的典型用途：内网 CI、交付源码包、审计依赖代码

> 现代化倾向：能在线访问代理就别 vendor，保持 go.mod 精简。

### 3.10 go env 关键变量与模块缓存

`go env` 一套变量控制模块下载与构建行为，常用如下：

```bash
# 查看全部环境变量
go env

# 常用关键变量
go env GOPROXY        # 模块代理，见 3.4
go env GONOSUMDB      # 不受 checksum 数据库约束的路径
go env GOPRIVATE      # = 私有不走代理 + 不查 sumdb
go env GOMODCACHE     # 模块缓存目录（默认 $GOPATH/pkg/mod）
go env GOFLAGS        # 全局构建参数，如 -mod=vendor、-trimpath
go env GOTOOLDIR      # 内置工具目录（compile/link 等）
```

**模块缓存结构**（`$GOPATH/pkg/mod`）：

```
pkg/mod/
├── cache/download/          # 下载的 .zip + .mod + .info（原始形态）
├── github.com/
│   └── gin-gonic/
│       └── gin@v1.9.1/      # 解压后的源码（只读）
│           ├── gin.go
│           └── ...
└── cache/                   # 校验与锁文件
```

> ⚠️ **C++ 对照**：Conan 的本地 cache（`~/.conan/data`）与此类似，但 Go 的缓存**是只读**的——不要手工改里面的源码。想要「本地 patched 库」，正确方式是 `replace`（见 3.6）。

`GOFLAGS=-mod=vendor` 可强制统一使用 vendor：

```bash
# 对共享/CI 环境强制 vendor 模式
go env -w GOFLAGS=-mod=vendor
```

### 3.11 从零到一：一份完整的 go.mod

一个用到 Gin + MySQL 驱动 + 工具库的小项目，规范工作流产生的完整 `go.mod`：

```go
// 第一步：go mod init
//   预期 module 行 = 仓库地址，保证可被别 import
module github.com/starer-code/order-app

go 1.22

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/go-sql-driver/mysql v1.8.1
)

// 带测试用的库也会出现在这里：
require (
    github.com/stretchr/testify v1.9.0 // indirect
    golang.org/x/sync v0.7.0         // indirect
)
```

对应的完整流程：

```bash
# 1. 初始化
go mod init github.com/starer-code/order-app

# 2. 写代码里 import 了 gin 与 mysql/tester，然后：
go mod tidy
#   → 自动为所有 import 添加 require 与 go.sum
#   → 没被代码引用的依赖被移除（间接）

# 3. 验证
go build ./...
go vet ./...
go test ./...
```

> ⚠️ **C++ 对照**：`// indirect` 注释的含义是「**不是我直接 import 的，是别的包带进来的**」——它出现在 `require` 里是因为你的直接依赖的 go.mod 也 require 它。`go mod tidy` 会自动管理这个标注，手工维护必出错。

### 3.12 常见 go mod 命令速查

```bash
go list -m all            # 列出全部（含间接）模块与版本
go list -m -versions gin  # 查看 gin 可用的全部发布版本
go mod graph              # 打印模块依赖有向图
go mod why github.com/x   # 解释为什么项目依赖它
go mod verify             # 校验本地缓存与 go.sum
go mod edit -require=...  # 命令行改 go.mod（脚本友好）
```

---

## 四、常见坑与误区

### 坑 1：手改 go.mod 的 require，导致版本不一致

- **现象**：手动在 `require` 里写了一个版本，`go build` 报「updates to go.mod needed」或校验失败。
- **原因**：go.mod 里 require 与 go.sum 必须配对，手写版本没生成对应 go.sum 行。
- **正确写法**：一律用 `go get pkg@version` 或改完代码跑 `go mod tidy`，让工具维护 go.mod/go.sum。

### 坑 2：`go env -w GOPROXY` 在旧版本 Go 不生效 / 配置漂移

- **现象**：设了 `go env -w` 后，另一台机器/另一个用户拉不到包。
- **原因**：`go env -w` 写的是**用户级**配置，不随项目走；且 `GO111MODULE` 在 Go 1.16 前未默认打开。
- **正确写法**：团队统一在 CI/文档中显式 `go env -w GOPROXY=...`；或在项目里放 `.go-version` / 使用 `.envrc` 约定。Go 1.16+ 无需关心 `GO111MODULE`。

### 坑 3：v2+ 模块没带 `/vN`，import 失败

- **现象**：`go get github.com/user/proj@v2.0.0` 报错或 import 不进去。
- **原因**：模块主版本 ≥2 时，module path 必须带 `/vN`，git tag 必须形如 `v2.0.0`。
- **正确写法**：fork 后 `go mod init github.com/user/proj/v2`，import `github.com/user/proj/v2/...`。

### 坑 4：`replace => ../本地路径` 相对路径漂移

- **现象**：本地替换的库跨机器后构建失效，或部署服务器上路径不存在。
- **原因**：`replace ... => ../mylib` 是相对路径，依赖项目在另一台机器上的位置。
- **正确写法**：本地联调用完**及时删除 replace** 并在 CI 中 `go mod tidy`；正式版本依赖用 tag/commit 而非本地路径。

### 坑 5：私有仓库被 go.sum / 代理卡住

- **现象**：下载私有模块报 `410 Gone`、`not found` 或 `checksum mismatch`。
- **原因**：私有模块走了公共代理，或不属于 GONOSUMDB 白名单，公共 checksum 库没有它。
- **正确写法**：`go env -w GOPRIVATE=github.com/mycompany/*`（同时绕过代理与 checksum 库）；确保开发机 git 能直连该仓库。

### 坑 6：`go get` 与 `go build` 版本不一致

- **现象**：`go get -u` 全量升级后，构建时用的还是旧版本。
- **原因**：go.mod 已改，但部分包的 go.mod 又携带 `require` 最低版本约束，形成「间接依赖拉高主依赖版本」的循环。
- **正确写法**：升级后跑 `go mod tidy` 收敛，必要时 `go get pkg@想要版本` 强制指定最终版本。

### 坑 7：忘在 CI 中设置 GOPROXY，国内构建超时

- **现象**：本机能构建，CI/服务器上卡在 downloading 直到超时。
- **原因**：CI 未配置镜像，直连 `proxy.golang.org` 被墙或慢。
- **正确写法**：CI 脚本开头 `go env -w GOPROXY=https://goproxy.cn,direct`（国内）或使用 `https://goproxy.io,direct`；企业内网可自建 Athens/Artifactory 做代理。

---

## 五、练习任务

- [ ] 用 `go mod init github.com/你的名字/hello` 新建项目，`go get` 一个 HTTP 库（如 gin），运行 `go mod tidy`，观察 go.mod 中 require 的变化与 go.sum 的生成
- [ ] 在旧项目上 `go get -u ./...` 升级全部依赖，用 `go list -m all` 查看依赖树，体会与 C++ 升级第三方库的风险差异（Go 无 ABI 危机）
- [ ] 对照 C++ 的「本地联调动态库/静态库」场景：写一个小库用 `replace => ../mylib` 本地替换，改代码后无需装包直接 `go build` 生效
- [ ] 模拟内网环境：`go mod vendor` 后删掉 `$GOPATH/pkg/mod` 中对应目录，用 `-mod=vendor` 构建，确认离线可编译
- [ ] 复刻 C++ 的 CMake `find_package` 私有仓库模式：设 `GOPRIVATE`，用 git 直连拉一个私有模块（或伪造一个本地 git 仓库练手）
- [ ] 写一个被依赖的 v2 库（`go mod init xxx/v2`），让另一个项目 import 它，加深对「版本即路径」的理解

---

## 六、延伸与参考

- 官方文档：[Go Modules Reference](https://go.dev/ref/mod)
- 官方文档：[Go 模块教程（Getting started with modules）](https://go.dev/doc/tutorial/create-module)
- 官方博客：[Using Go Modules](https://go.dev/blog/using-go-modules)
- 代理方案：[goproxy.cn（国内镜像）](https://goproxy.cn)

相关笔记：

- [[04-常用工具-gofmt-vet-doc-交叉编译]] —— `go mod tiny` 也在工具链中登场
- [[01-接口interface]] —— 面向接口编程决定「依赖注入」式代码结构
- [[05-构建部署与Docker化]] —— 依赖下载后如何变成可部署的镜像