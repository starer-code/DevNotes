# 01 - CLI 工具 flag 与 cobra

> 从 C++ 的 Boost.Program_options / CLI11 到 Go：标准库 flag 包入门，再上手 cobra 这个事实标准的命令行框架

---

## 一、简述

命令行工具（CLI）是 Go 最擅长的领域之一：编译出来是单一静态二进制，启动快、分发简单，天然适合写 `git` / `docker` 这类开发者工具。Go 在命令行的「外挂」上做了很多设计——`os.Args` 给你原始参数，标准库 `flag` 包给你简单的 `-name value` 解析，而 `spf13/cobra`（Kubernetes、Hugo、Docker CLI 大量使用）则提供子命令、flag 继承、自动帮助和 shell 补全的完整方案。

> **核心要点**：C++ 里解析命令行要么手写循环扫 `argv`，要么拉 Boost.Program_options / CLI11；Go 的路径是「标准库 flag 够用即用，复杂命令行直接上 cobra」。cobra 的「命令树」思想对 C++ 开发者来说很像「用对象组合搭一棵命令路由树」。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 入口参数 | `int main(int argc, char* argv[])` | `func main()` + `os.Args` | `os.Args[0]` 是程序名，Go 是切片可遍历 |
| 参数解析库 | Boost.Program_options / CLI11 | `flag`（标准库） | flag 零依赖，但功能简单 |
| 子命令框架 | 自己搭 / CLI11 | `github.com/spf13/cobra` | cobra 是事实标准（k8s/gh/hugo 都用） |
| 类型自动转换 | `boost::lexical_cast` | flag 绑定即转换 | `flag.Int` 自动转，无需显式 cast |
| 帮助文本 | 手动拼接打印 | flag / cobra 自动生成 | `-h` / `--help` 开箱即用 |
| 长短选项 | `-v` / `--verbose` | `-v` / `--verbose` 等价 | flag 单双横线都认；布尔无需值 |
| 子命令树 | 无标准方案 | cobra `AddCommand` 层层挂载 | 命令即对象，可嵌套 |
| shell 补全 | 无标准方案 | cobra `completion` 命令 | 生成 bash/zsh/fish 脚本 |
| 解析失败行为 | 抛异常 / 返回错误码 | flag 默认 `ExitOnError` | 可切换到 `ContinueOnError` 自己处理 |

---

## 三、逐主题详解

### 3.1 os.Args —— 原始参数切片

任何命令行的起点。和 C++ 的 `argc/argv` 相比，Go 把它做成了普通切片，不用数个数、不用指针算术：

```go
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("程序名:", os.Args[0]) // ./app
	fmt.Println("参数个数:", len(os.Args)-1)
	for i, a := range os.Args[1:] {
		fmt.Printf("参数%d: %s\n", i, a)
	}
}
```

```bash
go build -o app main.go
./app foo bar
# 程序名: ./app
# 参数个数: 2
# 参数0: foo
# 参数1: bar
```

> **C++ 对照**：`os.Args` 相当于 `argv`，但 Go 直接给 `[]string`，不需要 `argv[i]` 后手动 `std::string` 包装。注意 `os.Args[0]` 语义和 C++ 一致——都是**程序路径/程序名**，不是第一个参数。

### 3.2 标准库 flag —— 简单参数解析

flag 包专为 `-name value` / `--name value` 这种 POSIX 风格设计。定义一个 flag 就是声明一个变量，返回值是**指针**：

```go
package main

import (
	"flag"
	"fmt"
)

func main() {
	// 返回的都是 *string / *int / *bool
	name := flag.String("name", "world", "要问候的名字")       // -name x  / --name x
	count := flag.Int("count", 1, "重复次数")                  // -count 3
	verbose := flag.Bool("verbose", false, "是否输出详细信息")  // -verbose（布尔无需值）

	flag.Parse() // 关键：解析动作在这一步

	for i := 0; i < *count; i++ {
		if *verbose {
			fmt.Printf("#%d ", i+1)
		}
		fmt.Printf("Hello, %s!\n", *name)
	}

	// 位置参数（非 flag 的剩余参数）在 flag.Args() 里
	fmt.Println("位置参数:", flag.Args())
}
```

> ⚠️ 三个坑在同一个文件里埋着：**flag 返回的是指针**，用之前要 `*name` 解引用；**别忘了调用 `flag.Parse()`**——不调用则全部是默认值、位置参数也没人收集；**注册必须在 Parse 之前**（本例注册紧邻 Parse，安全；把注册挪到 Parse 之后就会被忽略）。

```bash
go run main.go -name Tom -count 2 -verbose
# #1 Hello, Tom!
# #2 Hello, Tom!
# 位置参数: []

go run main.go Tom
# Hello, world!
# 位置参数: [Tom]
```

flag 包自动生成的帮助：

```bash
go run main.go -h
# 输出自动生成的 Usage：
#   -count int
#         重复次数 (default 1)
#   -name string
#         要问候的名字 (default "world")
#   -verbose
#         是否输出详细信息
```

### 3.3 FlagSet —— 给一组命令各自独立的 flag

flag 包不支持子命令，但**命令行工具最常见的需求恰恰是子命令**（`git commit`、`docker run`、`go build`）。标准库的解法是 `flag.FlagSet`——每个子命令建一个独立的解析器：

```go
package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	// 解析出第一个非 flag 参数，当作子命令名
	args := os.Args[1:]
	if len(args) < 1 {
		usage()
		os.Exit(1)
	}

	switch args[0] {
	case "add":
		runAdd(args[1:])
	case "list":
		runList(args[1:])
	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Println("用法: todolist <add|list> [选项]")
}

func runAdd(args []string) {
	fs := flag.NewFlagSet("add", flag.ExitOnError)
	title := fs.String("title", "", "任务标题")
	fs.Parse(args)
	fmt.Printf("添加任务: %q\n", *title)
}

func runList(args []string) {
	fs := flag.NewFlagSet("list", flag.ExitOnError)
	all := fs.Bool("all", false, "显示全部含已完成")
	fs.Parse(args)
	fmt.Printf("列出任务 (all=%v)\n", *all)
}
```

```bash
go run main.go add -title "学 Go"
# 添加任务: "学 Go"
go run main.go list -all
# 列出任务 (all=true)
```

> **C++ 对照**：`flag.NewFlagSet` 每次解析互不干扰，相当于每个子命令函数各自有一个「局部 Boost.Program_options」实例。但 FlagSet 方案仍是手搓的——错误信息、帮助、子命令之间的 flag 共享都要自己管。

### 3.4 cobra 起步 —— 命令树框架

当命令多到 FlagSet 撑不住时，用 cobra。安装：

```bash
go get github.com/spf13/cobra@latest
```

最小编程模型：**一个根命令 + N 个子命令**，每个命令都是一个 `*cobra.Command` 对象，`Run` 字段是它被实际调用时执行的函数：

```go
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// 全局 flag 变量（cobra 不返回指针，而是绑定到变量）
var (
	verbose bool
	name    string
)

// 1. 根命令：程序对外暴露的名字是 app
var rootCmd = &cobra.Command{
	Use:   "app",
	Short: "一个示例 CLI",
	Long:  "app 是一个用来演示 cobra 的示例命令，包含根命令和子命令。",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("你好，%s（verbose=%v）\n", name, verbose)
	},
}

// 2. 子命令 greet：要求恰好 1 个位置参数
var greetCmd = &cobra.Command{
	Use:   "greet <名字>",
	Short: "向某人问好",
	Args:  cobra.ExactArgs(1), // 参数数量校验，不满足会报错
	Run: func(cmd *cobra.Command, args []string) {
		names := args[0]
		if verbose {
			fmt.Printf("[verbose] 开始打招呼...\n")
		}
		fmt.Printf("你好，%s！\n", names)
	},
}

func init() {
	// PersistentFlags：该 flag 对其自身和所有子命令都生效
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose 输出")
	// Flags：只对当前命令生效
	rootCmd.Flags().StringVar(&name, "name", "world", "要问候的名字")

	// 把子命令挂到根命令上
	rootCmd.AddCommand(greetCmd)
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

运行效果：

```bash
go run . -name Alice
# 你好，Alice（verbose=false）

go run . greet 小明 -v
# [verbose] 开始打招呼...
# 你好，小明！

go run . greet            # 参数不足
# Error: accepts 1 arg(s), received 0
```

> **C++ 对照**：cobra 一个命令一个对象，`AddCommand` 把子命令挂成树。这不就是「命令即对象 + 组合模式」？C++ 里你要么手写 if-else 分发，要么借 CLI11 的子命令——cobra 则把分发、帮助、补全全部内建了。

### 3.5 命令模板组织 —— 工程化的目录布局

真实项目的 cobra 代码不写在 main.go 里，而是按「cmd/ + internal/」组织。参考 Kubernetes/Hugo 的布局：

```bash
mycli/
├── main.go              # 只做一件事：调 cmd.Execute()
├── go.mod
├── cmd/                 # 命令定义区
│   ├── root.go          # 根命令 + 全局 flag
│   ├── add.go           # add 子命令
│   └── list.go          # list 子命令
└── internal/            # 业务实现（不对外导出）
    └── todo/
        └── todo.go      # todo 的具体逻辑
```

```go
// main.go —— 入口只留 execute
package main

import "mycli/cmd"

func main() {
	cmd.Execute()
}
```

```go
// cmd/root.go —— 根命令定义 Execute 符号
package cmd

import (
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "mycli",
	Short: "一个多子命令 CLI 工具",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	// 注意这里把子命令注册集中到 root.go，或分散在各 *_test.go 旁
	rootCmd.AddCommand(addCmd, listCmd)
}
```

```go
// cmd/add.go —— 每个子命令一个文件
package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var addCmd = &cobra.Command{
	Use:   "add <标题>",
	Short: "添加一条待办",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("添加待办: %s\n", args[0])
	},
}
```

> **为什么要这样分**：main.go 只负责「用 cobra 启动」，命令逻辑都藏在 `cmd/`，业务代码放 `internal/`。既符合 Go 的包设计习惯，也让每个子命令可以独立写单测。

### 3.6 补全与帮助文本

cobra 自带 shell 补全，往根命令加上 `completion` 子命令即可：

```go
// cmd/root.go 里追加
func init() {
	rootCmd.AddCommand(completionCmd)
}

var completionCmd = &cobra.Command{
	Use:   "completion [bash|zsh|fish]",
	Short: "生成 shell 补全脚本",
	Args:  cobra.ExactValidArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		switch args[0] {
		case "bash":
			rootCmd.GenBashCompletion(os.Stdout)
		case "zsh":
			rootCmd.GenZshCompletion(os.Stdout)
		case "fish":
			rootCmd.GenFishCompletion(os.Stdout, true)
		}
	},
}
```

```bash
go build -o mycli .
./mycli completion bash > /etc/bash_completion.d/mycli  # 安装补全
./mycli help          # 查看帮助
./mycli greet --help  # 查看子命令帮助
```

而且 cobra 帮助文本是**结构化的**：`Use` 定义调用形如 `app greet <名字>`，`Short`/`Long` 分别是一句话和详细说明，`Example` 字段可以写示例用法。这些会自动拼进 `-h` 输出。

### 3.7 小结：什么时候用 flag，什么时候用 cobra

| 场景 | 选择 |
|------|------|
| 单命令 + 几个选项（如 `myfmt -width 4 file`） | flag 包足够 |
| 多子命令、要共享 flag、要补全 | cobra |
| 面向用户的正式工具（要发行、要 man page、要补全） | 直接 cobra |

---

## 四、常见坑与误区

### 坑 1：`os.Args[0]` 是程序名，误当第一个参数

- **现象**：`./app foo bar` 里循环 `os.Args`，程序名被当成参数处理。
- **原因**：`os.Args[0]` 语义和 C++ `argv[0]` 一致，约定存程序路径。
- **正确写法**：要取用户参数从 `os.Args[1:]` 开始；优先用 flag/cobra 而非手搓。

### 坑 2：flag 返回指针，忘记解引用

- **现象**：`fmt.Println(name)` 打印出一串地址/`0xc000...`。
- **原因**：`flag.String` 返回 `*string`，不是值。
- **正确写法**：`name := flag.String(...)` 后一律用 `*name`；或改用 `flag.StringVar(&name, ...)` 绑定到普通变量（cobra 的 `StringVar` 也是这个套路）。

### 坑 3：忘了调 `flag.Parse()`

- **现象**：所有 flag 都是默认值，命令行传了也像没传。
- **原因**：flag 包的解析动作发生在 `Parse()`，注册只是声明。
- **正确写法**：`flag.Parse()` 必须在所有 flag 注册完成、在使用之前调用；放 main 开头紧邻注册处。

### 坑 4：位置参数之后的「-flag」不再解析

- **现象**：`./app file.txt -verbose` 里 `-verbose` 没生效。
- **原因**：Go flag 在遇到**第一个非 flag 参数**时就停止解析，之后的都算位置参数（POSIX 惯例）。
- **正确写法**：选项放前面 `./app -verbose file.txt`；或对 `flag.Args()` 里的参数再手动处理。

### 坑 5：布尔 flag 被传值误伤

- **现象**：`./app -debug false` 变成 `debug=true`，`false` 反而成了位置参数。
- **原因**：`flag.Bool` 是「无值开关」，`-debug` 即 true；要给 false 应写 `-debug=false`。
- **正确写法**：布尔开关 `-verbose` / `--verbose`；需要显式值用 `-verbose=false`；想「反义开关」可定义 `-no-color`。

### 坑 6：flag.ExitOnError 在解析失败时直接退出

- **现象**：传了未定义 flag（如 `-x`），程序直接打印错误后退出，连 defer 都没执行。
- **原因**：`flag.CommandLine` 默认 `ExitOnError`，遇到错误 `os.Exit(2)`。
- **正确写法**：`flag.NewFlagSet("name", flag.ContinueOnError)` 自行接管错误，或直接交给 cobra（它返回 error，由 `Execute()` 统一处理）。

### 坑 7：`PersistentFlags` 和 `Flags` 混用不清

- **现象**：根命令上定义 `Flags().StringVar(...)`，期望子命令也能用，结果子命令里读不到。
- **原因**：`PersistentFlags()` 才对自己的**所有子命令**生效；`Flags()` 只对该命令自己生效。
- **正确写法**：全局选项（如 `--verbose`、`--config`）一律 `rootCmd.PersistentFlags().XxxVar(...)`。

---

## 五、练习任务

- [ ] 用 `os.Args` 手写一个 `echo` 模拟器：打印除程序名外的所有参数，用空格连接
- [ ] 用 flag 包实现 `mystat`：`-human`（人性化大小）、`-d`（只看目录）、一个位置参数路径
- [ ] 用 `flag.FlagSet` 拆两个子命令：`add title` 和 `done id`，各自独立 flag
- [ ] 用 cobra 实现一个 `todo` 命令：`add`、`list`、`done` 三个子命令，`--verbose` 为全局 flag
- [ ] **对照 C++ 重写**：把之前用 Boost.Program_options（或手写 argv 解析）写过的任何小工具，用 cobra 重写一遍并对比代码量
- [ ] 给 cobra 命令加 `completion` 子命令，本地安装 bash 补全验证生效
- [ ] 把从命令行读到的 JSON 配置路径，用 `-config` flag 接入上一篇的 `LoadConfig`（见 [05-encoding-json与配置文件](../02-语言进阶/05-encoding-json与配置文件.md)）

---

## 六、延伸与参考

- flag 官方文档：<https://pkg.go.dev/flag>
- cobra 官方仓库（含入门 tutorial）：<https://github.com/spf13/cobra>
- cobra 用户手册（命令/flag/补全约定）：<https://cobra.dev/>
- 《Go 语言圣经》命令行参数章节：<https://books.studygolang.com/gopl-zh/ch2/ch2-05.html>
- 相关笔记：[[02-原生HTTP服务-net-http]] · [[05-综合项目实战记录]] · [[09-包与导入]]