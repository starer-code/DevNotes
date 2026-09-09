# 04 - 常用工具 gofmt/vet/doc/交叉编译

> 从 clang-format/clang-tidy/doxygen 到 Go 内建工具链：规范靠工具强制，而非风格文档

---

## 一、简述

Go 的工具链是「一个 `go` 命令 + 若干子命令」的整体。`gofmt` 统一代码格式、`go vet` 做静态检查、`go doc` 生成/查看文档、`go build` 配合环境变量实现交叉编译。与 C++ 需要 `clang-format` + `clang-tidy` + `doxygen` + 一堆脚本不同，**Go 把规范内置**——`gofmt` 的格式无人争论，因为唯一标准。

> **核心要点**：`go fmt` 已在 Go 1.19+ 内置了 gofmt（两者等价）；真正的工程价值是让「风格讨论」从代码评审里消失——C++ 团队为空格和括号开过的会，在 Go 里不存在。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 代码格式化 | clang-format（需 .clang-format 配置） | `gofmt` / `go fmt` | **零配置**，官方唯一风格 |
| 静态检查 | clang-tidy / cppcheck | `go vet` | 内建，覆盖导入/函数调用等 |
| 文档生成 | doxygen（注释标记 + 配置） | `go doc` + `godoc` | 注释即文档，无需单独构建 |
| 文档注释风格 | `///`、块注释 + doxygen 指令 | 成对注释（块首选） | `// 名称 描述` 约定，导出符号必须注释 |
| 交叉编译 | 每平台一套交叉工具链/CI | `GOOS=linux GOARCH=amd64 go build` | 一条命令 + 环境变量 |
| 静态链接 | `-static` / 静态库手动组合 | `CGO_ENABLED=0` | 默认即可产纯静态二进制 |
| 精简体积 | `-s` strip 符号 | `-ldflags "-s -w"` | 编译期传递 linker 参数 |
| 依赖清理 | CMake/vcpkg 手工重配 | `go mod tidy` | 与工具链一体 |

---

## 三、逐主题详解

### 3.1 gofmt / go fmt：官方格式

```bash
# 查看差异（不修改）
gofmt -l .                 # 列出格式不达标的文件
gofmt -d file.go           # 输出 diff 视角的差异

# 覆盖写文件
gofmt -w file.go
go fmt ./...               # 等价于 gofmt -w，作用于当前包全部 .go

# gofmt 不影响语义：只重排缩进、对齐、换行、导入块
```

关键规则（**你不需要背，工具会改**）：

- 缩进统一 Tab；运算符两侧空格；可见性遵循同一惯例
- 导入按标准库/第三方/本地分组

> ⚠️ **C++ 对照**：clang-format 有 `.clang-format` 且各团队风格不同；`gofmt` **没有配置项**（少量见仁见智处除外），结果唯一。别说「你的风格」，说「gofmt 怎么说」。Git 提交钩子/CI 可强制 `gofmt -l .` 为空。

### 3.2 go vet：静态检查

`go vet` 检查代码中可疑但能编译的模式：

```bash
go vet ./...
```

**高价值检查项（对应目录 `cmd/vet` 的报告名）**：

| 检查 | 实例/含义 |
|------|-----------|
| `Printf` 族 | 格式串与参数不匹配（`fmt.Printf("%d", "s")`） |
| `CopyLock` | 复制了含 `sync.Mutex` 的结构体（值拷贝后在多 goroutine 下竞态） |
| `Unreachable` | 不可达代码 |
| `UntaggedSwitch` | 无标签的 `switch t := v.(type)` 之类 |
| `StructTag` | 结构体标签格式非法（如 `json:"x"` 拼错） |
| `Loopclosure` | 循环变量被闭包捕获（和测试章节的坑同源） |

```go
// vet 能抓到的典型问题
package main

import "fmt"

func main() {
    fmt.Printf("%d", "hello")   // ❌ vet: format %d has arg of wrong type string
    _ = 1
    return
    fmt.Println("不可达")         // ❌ vet: unreachable code
}
```

```bash
# 输出
# printf: Printf format %d has arg "hello" of wrong type string
# unreachable: unreachable code
```

> **C++ 对照**：`go vet` ≈ `clang-tidy` 的常见规则子集。区别：Go 的 vet 与编译器同一仓库、默认随发行，**不需要装工具链/配规则文件**。

### 3.3 go doc / godoc：注释即文档

Go 的文档约定就一条：**导出符号的声明紧贴上方写注释，注释以符号名开头**。

```go
// now returns the Unix 时间戳。   ← 导出函数，注释以函数名开头
// 这是第二行说明。
func NowUnix() int64 {
    return time.Now().Unix()
}

// Config 是应用的配置联合体。
type Config struct {
    Port int
}
```

查看文档（不依赖单独构建）：

```bash
# 命令行查看（-s 简化：只看声明与注释，不展开实现细节混排）
go doc time.Now
go doc -s strings.ReplaceAll

# 查看当前包的全部文档
go doc ./internal/config

# 网页版：godoc -http=:6060 后浏览器访问 localhost:6060/pkg/myapp
```

> **C++ 对照**：doxygen 需要 `///` 标记 + 配置文件 + 生成 HTML；Go 的注释就是普通 Go 注释，`godoc` 网页服务几秒内可开，且与源码 hyperlink 互联。

### 3.4 go mod tidy：依赖与代码对齐

```bash
# 增删依赖：按当前 import 语句补全/去除 require
go mod tidy

# 通常每次改完代码后与 gofmt 一起跑
gofmt -w . && go vet ./... && go test ./... && go mod tidy
```

`go mod tidy` 会连带更新 `go.sum`，并修正 `go.mod` 里的 `go` 指令版本。详见 [[01-go-mod依赖管理]]。

### 3.5 go generate：代码生成（简述）

`go generate` 扫描文件中的 `//go:generate` 指令并执行，常用于把「手写样板」自动化：

```go
//go:generate stringer -type=Pill
type Pill int

const (
	Placebo Pill = iota
	Aspirin
	Ibuprofen
)
```

```bash
# 触发所有文件的 go:generate 指令
go generate ./...
```

> **C++ 对照**：对应 CMake 的代码生成（`add_custom_command` 跑 protobuf/IDL 编译器）。区别：`go generate` 把生成命令**写进源码注释**，随包走，任何人跑同一命令得到同一结果。

### 3.6 交叉编译：一套代码多平台产物

```bash
# Linux amd64（最常见的服务端目标）
GOOS=linux GOARCH=amd64 go build -o app-linux-amd64 ./cmd/server

# Windows amd64
GOOS=windows GOARCH=amd64 go build -o app.exe ./cmd/server

# macOS（Apple Silicon）
GOOS=darwin GOARCH=arm64 go build -o app-darwin-arm64 ./cmd/server

# 查看当前目标平台
go env GOOS GOARCH CGO_ENABLED
```

**CGO 开关对交叉编译的决定性作用**：

```bash
# CGO_ENABLED=0：纯 Go 静态编译，无视目标机 C 工具链，交叉编译无忧
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./cmd/server

# CGO_ENABLED=1（默认）：能用 cgo 调用 C 库，但交叉编译需要目标平台 C 编译器
#  Linux→Windows 常用 mingw；日常服务端建议直接禁 cgo
```

> ⚠️ **C++ 对照**：C++ 交叉编译要配整套目标平台工具链（sysroot/交叉 gcc/库），Qt 更是按平台重编；Go 纯 Go 代码 `CGO_ENABLED=0` 一条命令出任意平台二进制——**这是 Go 部署场景对 C++ 的最大碾压点之一**。

### 3.7 精简产物体积：-ldflags

```bash
# -s: 剥离符号表；-w: 剥离 DWARF 调试信息（约减 30%~50%）
go build -ldflags "-s -w" -o app ./cmd/server

# 查看体积
ls -lh app

# 还可以注入版本号（配合构建脚本给二进制打标）
# go build -ldflags "-X main.version=1.2.3 -s -w" ...
```

代价：`strip` 后无法用调试器断点定位线上 panic 堆栈的源码行。特别地，想要**精简且可辨认堆栈**，可只 `-w` 不 `-s`。

> **C++ 对照**：等价 gcc `-s` 与去掉 `-g`。注意 Go 即使不 strip，其二进制也比「静态链接 C++ 程序」小不少，且天然无动态依赖。

### 3.8 一行完成全套体检

```bash
# 每日提交前的固定动作
gofmt -l .          && \
go vet ./...        && \
go test ./... -race && \
go mod tidy
```

> 把上面这行写进 CI 或 pre-commit，就拿到了「格式、静态、动态、依赖」四个维度的守门员。

### 3.9 GOOS / GOARCH 全量速查

交叉编译只需设两个环境变量，`GOOS`（系统）+ `GOARCH`（架构）：

| GOOS | GOARCH | 产物示例 | 常见用途 |
|------|--------|----------|----------|
| linux | amd64 | ELF x86-64 | 云服务器主力 |
| linux | arm64 | ELF aarch64 | 树莓派/鲲鹏/ARM 服务器 |
| linux | arm | ELF arm | 低端嵌入式 |
| windows | amd64 | PE x86-64（.exe） | 桌面工具 |
| windows | arm64 | PE arm64 | 少见 |
| darwin | amd64 | Mach-O x86-64 | Intel Mac |
| darwin | arm64 | Mach-O arm64 | M1/M2 Mac |
| linux | 386 | ELF i386 | 老旧 32 位服务器 |

```bash
# 树莓派
GOOS=linux GOARCH=arm64 go build ./cmd/server

# 老 x86 服务器
GOOS=linux GOARCH=386 go build ./cmd/server

# 全部支持平台
go tool dist list
```

> **C++ 对照**：这套矩阵，C++ 得为每个平台准备一套交叉工具链；Go 只在涉及 cgo/CGO 时才需要。**纯 Go 条件下，平台只是两个环境变量**。

### 3.10 构建约束与文件标签：//go:build

按平台/特性条件编译，用文件顶部注释（Go 1.17+ 语法）：

```go
//go:build linux && amd64

package main

// 只在 linux+amd64 时参与编译的实现
```

```go
//go:build !windows

package main

// 非 Windows 的备用实现
```

常见组合：

| 约束 | 含义 |
|------|------|
| `//go:build linux` | 仅 linux |
| `//go:build cgo` | 仅 cgo 开启时 |
| `//go:build ignore` | 该文件永不参与编译（保留草稿） |
| `//go:build go1.18` | Go ≥ 1.18 才编译 |

命名惯例：`xxx_windows.go`、`xxx_linux.go`、`xxx_unix.go`（`unix` 是构建标签约束，非系统名），把「同函数不同实现」拆到独立文件。

> **C++ 对照**：对应 `#ifdef _WIN32` / `#if __linux__`。区别在于 Go 按**文件名后缀 + 顶部标签**两条路径，只有两种机制，比 `#ifdef` 满天飞清爽得多。

```bash
# 查看某文件在哪个平台被编译
go list -f '{{.GoFiles}}' .          # 当前平台编译的文件
GOOS=windows go list -f '{{.GoFiles}}' .  # windows 视角的文件集
```

### 3.11 -ldflags 注入版本号：给二进制打标

部署时要知道「线上跑的是哪个 commit」，用 `-X` 把变量写进二进制：

```go
// cmd/server/main.go
package main

// 这三个变量编译期由 -ldflags 注入
var version = "dev"
var commit = "none"
var buildTime = "unknown"

func main() {
	// 启动打点：./app -version 或日志输出
	fmt.Printf("version=%s commit=%s build=%s\n", version, commit, buildTime)
	// server.Run()
}
```

构建脚本：

```bash
# 注入三个值（字符串里含空格要转义；-X 语法：-X importpath.name=value）
VERSION=1.2.3
COMMIT=$(git rev-parse --short HEAD)
DATE=$(date +%Y%m%d%H%M%S)

CGO_ENABLED=0 go build \
  -ldflags "-s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.buildTime=$DATE" \
  -o app ./cmd/server

# 运行确认
./app
# version=1.2.3 commit=abc1234 build=20260822120000
```

之后用 `go version -m` 反查二进制信息：

```bash
go version -m ./app
# ./app: go1.22.5
#   path    order-app
#   mod     github.com/gin-gonic/gin  v1.9.1
#   build   -ldflags "-s -w -X main.version=1.2.3 ..."
```

> 💡 **C++ 对照**：等价于 CMake 里 `target_compile_definitions(... VERSION=\"1.2.3\")` + 编译日期宏。但 Go 的 `go version -m` 还能直接读出**依赖版本清单**——排查「线上用哪版库」不依赖 CI 记录，一个人也能事后取证。

### 3.12 其它常用 go 子命令一览

```bash
go install example.com/cmd@latest   # 装第三方命令到 GOBIN（类似 go get 老行为）
go run ./cmd/server                 # 编译并立即运行（开发迭代）
go build ./...                      # 构建所有包（不产可执行，仅检查）
go version                          # 查看 Go 版本
go tool compile -S file.go          # 看汇编（性能分析用）
go tool objdump -s main.main app    # 反汇编指定函数
go env -w GOFLAGS=-trimpath         # 去除构建路径信息（可复现构建）
go clean -cache                     # 清构建缓存
```

`go install` 在 Go 1.16+ 语义已变：指定 `@version` 时**不写 go.mod**，直接装到 `$(go env GOBIN)`，适合装工具链命令。

---

## 四、常见坑与误区

### 坑 1：忘跑 gofmt，提交后 diff 一团糟

- **现象**：代码评审里出现大量空格/缩进噪音；`gofmt -l` 报一堆文件。
- **原因**：手工排版与官方格式有差异，编辑器没配保存时格式化。
- **正确写法**：编辑器配置（VS Code Go 插件 / vim `gofmt` on save）；提交前跑 `gofmt -w .`。

### 坑 2：`fmt.Printf("%d", s)` 编译通过但 vet 直报

- **现象**：格式化参数类型不匹配，运行时输出诡异但不报错。
- **原因**：`fmt` 的 `%` 检查只在 `vet` 阶段——编译器放行，运行时静默用默认格式。
- **正确写法**：写格式化字符串时用 `go vet` 护航；`%w` 只用于 `fmt.Errorf`。

### 坑 3：交叉编译带上 CGO，产物跑不起来

- **现象**：`GOOS=linux GOARCH=amd64 go build` 后，目标机上 `exec format error` 或缺 `libc`。
- **原因**：默认 `CGO_ENABLED=1`，链接了目标平台的 C 库；如果用了 cgo 特性则要求目标机有对应动态库。
- **正确写法**：服务端/纯 Go 项目统一 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build`。

### 坑 4：`go vet` 对 main 包的社区库误报 / 忽略

- **现象**：`go vet ./...` 在黑名单包（含 unsafe/反射黑魔法）或旧库上卡住或误报。
- **原因**：vet 是「保守启发式」，对少数 `unsafe` 场景不理解；部分第三方库自带 vet 例外。
- **正确写法**：先把白名单包排除（`go vet ./...` 后跳过明确已知的误报），自己的代码路径保持干净。

### 坑 5：`go doc` 看不到注释或网页空白

- **现象**：`go doc 自己的包` 不输出注释，godoc 网页也空白。
- **原因**：注释没有以符号名开头；或没有导出符号。
- **正确写法**：注释第一段以符号名开头（`// Config 是……`、`// NowUtils 返回……`），保持为**完整句子**。

### 坑 6：`go generate` 每次 CI 输出不同产物导致构建漂移

- **现象**：generated 文件改了但没人重跑，演示环境与本地不一致。
- **原因**：把生成物当手写代码维护，或生成器依赖环境（时区/路径）。
- **正确写法**：generated 文件头部加 `// Code generated ... DO NOT EDIT.`；CI 中先 `go generate ./...` 再 build，并检查 git diff 是否为空。

### 坑 7：用 gofmt 处理生成的 JSON/模板拼接导致文件语义变化

- **现象**：`gofmt -w` 格式化含内嵌字符串模板的文件后，运行输出变化。
- **原因**：gofmt 只重排，不改变字符串内容——但若模板写在注释/原始字符串外拼接拼接，重排会动到它。
- **正确写法**：模板/嵌 SQL 用 raw string（反引号）避免逃逸与重排歧义；gofmt 后跑一次测试确认无回归。

---

## 五、练习任务

- [ ] 故意写一段混乱格式的 Go 代码，运行 `gofmt -d` 查看 diff，再 `gofmt -w` 应用，对比前后
- [ ] 写三个「能触发 go vet」的坏代码（Printf 错型、不可达代码、结构体标签错误），`go vet ./...` 逐一认领报告并修复
- [ ] 对照 C++ 的 doxygen：为自己写的一个导出函数+类型配好「符号名开头」注释，用 `go doc -s` 查看呈现效果
- [ ] 把现有项目抄一页到全新目录，配好 `go mod init`，依次跑 `gofmt -l . → go vet ./... → go test ./...`，体验零配置工具链
- [ ] 交叉编译大练习：用 `CGO_ENABLED=0` 编译出 linux/amd64、windows/amd64、darwin/arm64 三个二进制，用 `file` 命（或 `file app`）验证机器类型
- [ ] 用 `-ldflags "-s -w"` 重新编译，对比 strip 前后体积与 `go version -m app` 输出的差异
- [ ] 为 `go generate` 写一个最小示例（如 stringer），把生成的 `*_string.go` 提交前跑 `go generate ./...` 保持同步

---

## 六、延伸与参考

- 官方文档：[gofmt 与 go fmt](https://go.dev/cmd/gofmt/)
- 官方文档：[go vet 命令](https://go.dev/cmd/vet/)
- 官方文档：[godoc / 文档注释约定](https://go.dev/doc/comment)
- 官方博客：[Cross-compiling Go（交叉编译）](https://go.dev/solutions#cross-platform)

相关笔记：

- [[01-go-mod依赖管理]] —— go mod tidy 与 toolchain 一体
- [[02-测试-单元-表格驱动-基准-覆盖率]] —— vet + race + cover 构成静态/动态双保险
- [[05-构建部署与Docker化]] —— 交叉编译产物进了 Docker 镜像就是部署