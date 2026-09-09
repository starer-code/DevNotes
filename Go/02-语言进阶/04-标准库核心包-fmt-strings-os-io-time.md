# 04 - 标准库核心包：fmt / strings / os / io / time

> 从 C++ 的 iostream / string / fstream / chrono 到 Go 标准库核心包

---

## 一、简述

Go 标准库是"开箱即用"的典范——网络、JSON、加密、压缩、时间、文件全都在标准库里。本笔记聚焦日常开发最高频的 5 个包：`fmt`（格式化）、`strings`（字符串）、`os`（文件/环境）、`io`（读写抽象）、`time`（时间）。

> **核心要点**：这些包配合 Go 的"接口即抽象"哲学（`io.Reader` / `io.Writer`），形成了统一的数据流处理模型——**你写的函数只需要面向接口，就能处理文件、内存、网络任何来源**。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 格式化输出 | `std::cout << x` | `fmt.Println(x)` | Go 内置格式动词 |
| 格式化字符串 | `sprintf(buf, "%d", x)` | `fmt.Sprintf("%d", x)` | 返回 string，无缓冲区 |
| 字符串操作 | `std::string` / `<cstring>` | `strings` 包 | 函数式，无成员方法 |
| 字符串拼接 | `s1 + s2` | `strings.Join` / `strings.Builder` | 大量拼接用 Builder |
| 文件读取 | `std::ifstream` | `os.Open` + `io.ReadAll` | 接口化 |
| 文件写入 | `std::ofstream` | `os.WriteFile` | 一键写整个文件 |
| 时间获取 | `std::chrono::system_clock::now()` | `time.Now()` | 返回 Time 结构体 |
| 休眠 | `std::this_thread::sleep_for` | `time.Sleep` | 用法相似 |
| 计时 | `std::chrono::duration` | `time.Since(t)` | 返回 Duration |

---

## 三、fmt —— 格式化

### 3.1 输出函数

```go
fmt.Print("a", "b")        // 无换行、无空格: ab
fmt.Println("a", "b")      // 空格分隔 + 换行: a b
fmt.Printf("%s %d", "go", 1)  // 格式化: go 1

// 返回字符串版本
s := fmt.Sprintf("%s-%d", "v", 3)  // "v-3"
```

### 3.2 常用格式动词

| 动词 | 含义 | 示例 |
|------|------|------|
| `%v` | 默认格式（任意类型） | `fmt.Printf("%v", 42)` |
| `%+v` | 结构体带字段名 | `fmt.Printf("%+v", p)` → `{Name:tom Age:18}` |
| `%#v` | Go 语法表示 | `fmt.Printf("%#v", p)` → `main.Person{Name:"tom"}` |
| `%T` | 类型 | `fmt.Printf("%T", 42)` → `int` |
| `%d` | 十进制整数 | `42` |
| `%x` | 十六进制 | `2a` |
| `%f` / `%.2f` | 浮点 / 保留两位 | `3.14` / `3.14` |
| `%s` | 字符串 | `"hello"` |
| `%q` | 带引号字符串 | `"hello"` |
| `%t` | 布尔 | `true` |
| `%p` | 指针地址 | `0xc0000b2000` |

### 3.3 对齐与宽度

```go
fmt.Printf("%-10s|%10s\n", "left", "right")
// left      |     right

fmt.Printf("%05d\n", 42)   // 00042（前导零）
```

---

## 四、strings —— 字符串处理

Go 的 `string` 是不可变值类型，所有操作都返回新字符串。

### 4.1 常用函数

```go
import "strings"

s := "hello, world"

strings.Contains(s, "world")    // true
strings.HasPrefix(s, "hel")     // true
strings.HasSuffix(s, "rld")     // true
strings.Index(s, ",")           // 5（找不到返回 -1）
strings.Count(s, "l")           // 3

// 大小写
strings.ToUpper(s)              // "HELLO, WORLD"
strings.ToLower(s)

// 拆分与拼接
parts := strings.Split("a,b,c", ",")     // []string{"a","b","c"}
joined := strings.Join(parts, "-")       // "a-b-c"
strings.Fields("  a  b ")                // []string{"a","b"}（按空白）

// 去除与替换
strings.TrimSpace("  hi  ")          // "hi"
strings.Trim(s, "!")                 // 去除两端指定字符
strings.Replace(s, "l", "L", 2)      // 替换前 2 个
strings.ReplaceAll(s, "l", "L")      // 全部替换

// 重复
strings.Repeat("ab", 3)              // "ababab"
```

### 4.2 高效拼接：strings.Builder

```go
// ❌ 反面：循环里直接 + 拼接（多次分配内存）
func bad(n int) string {
    s := ""
    for i := 0; i < n; i++ {
        s += "x"  // 每次创建新字符串
    }
    return s
}

// ✅ 正确：Builder（类似 C++ 的 std::ostringstream）
func good(n int) string {
    var sb strings.Builder
    for i := 0; i < n; i++ {
        sb.WriteString("x")
    }
    return sb.String()
}
```

### 4.3 字符串与字节转换

```go
s := "hello"
b := []byte(s)        // string → []byte（拷贝）
s2 := string(b)       // []byte → string

// 遍历字符（rune）
for i, r := range "你好go" {
    fmt.Printf("字节位%d: %c\n", i, r)
}
// 注意：中文字符占 3 字节，i 是字节下标不是字符下标
```

---

## 五、os —— 文件与系统

### 5.1 文件操作（C++ fstream 对照）

```go
import "os"

// 读整个文件（小文件，最常用）
data, err := os.ReadFile("config.yaml")
if err != nil {
    log.Fatal(err)
}
fmt.Println(string(data))

// 写整个文件
err = os.WriteFile("out.txt", []byte("hello"), 0644)
if err != nil {
    log.Fatal(err)
}

// 打开文件流式读取
f, err := os.Open("big.log")
if err != nil {
    log.Fatal(err)
}
defer f.Close()  // 必须 defer 关闭！

buf := make([]byte, 1024)
n, err := f.Read(buf)  // 读一块
fmt.Printf("读了 %d 字节: %s\n", n, buf[:n])
```

### 5.2 追加写入

```go
f, err := os.OpenFile("log.txt",
    os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
if err != nil {
    log.Fatal(err)
}
defer f.Close()
f.WriteString("新的日志行\n")
```

### 5.3 环境变量与参数

```go
os.Getenv("PATH")        // 读环境变量
os.Setenv("MY_VAR", "1") // 设置（仅本进程）
os.Args                 // 命令行参数 []string，os.Args[0] 是程序名
os.Exit(1)              // 立即退出（不会执行 defer！）
```

---

## 六、io —— 读写抽象（Go 的精髓）

`io.Reader` / `io.Writer` 是 Go 数据流的核心接口：

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}
type Writer interface {
    Write(p []byte) (n int, err error)
}
```

**文件、网络连接、内存缓冲、压缩流、HTTP 响应体全部实现这两个接口**——所以可以统一处理：

```go
import (
    "fmt"
    "io"
    "log"
    "os"
    "strings"
)

func main() {
    // 从任意 Reader 读全部内容
    r1 := strings.NewReader("来自内存")        // 内存
    f, err := os.Open("file.txt")            // 文件
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()                          // 打开后立刻 defer 关闭
    r2 := f                                  // 文件也是 io.Reader
    // 网络: resp.Body

    data1, _ := io.ReadAll(r1)
    data2, _ := io.ReadAll(r2)               // r2 是 *os.File，也实现了 Reader
    fmt.Println(string(data1), string(data2))

    // 拷贝：Reader → Writer（文件、网络、标准输出都行）
    io.Copy(os.Stdout, strings.NewReader("打印我\n"))
}

// 常用函数
io.ReadAll(r)            // 读全部
io.Copy(dst, src)        // 流式拷贝
io.WriteString(w, "s")   // 写字符串
io.MultiReader(r1, r2)   // 合并多个 Reader
io.MultiWriter(w1, w2)   // 同时写多个 Writer
```

> **对照 C++**：`io.Reader` ≈ `std::istream`，`io.Writer` ≈ `std::ostream`。但 Go 的接口是**鸭子类型**——任何有 `Read(p []byte)` 方法的类型都是 Reader，不需要继承。

### 标准输入输出

```go
// 读一行（类似 std::cin >> / getline）
reader := bufio.NewReader(os.Stdin)
line, _ := reader.ReadString('\n')
fmt.Println("你输入了:", line)

// 扫描单词
scanner := bufio.NewScanner(os.Stdin)
for scanner.Scan() {
    fmt.Println("单词:", scanner.Text())
}
```

---

## 七、time —— 时间

### 7.1 获取时间与格式化

```go
import "time"

now := time.Now()                     // 当前时间 Time
fmt.Println(now)                      // 2026-08-09 12:00:00 +0800 CST

// 格式化（注意：Go 用"参考时间" 2006-01-02 15:04:05，不是 %Y-%m-%d）
fmt.Println(now.Format("2006-01-02"))           // 2026-08-09
fmt.Println(now.Format("2006-01-02 15:04:05"))  // 2026-08-09 12:00:00
fmt.Println(now.Format("15:04"))                // 12:00
```

> ⚠️ **最大的坑**：Go 的格式化模板是 `2006-01-02 15:04:05`（记忆口诀：2006 年 1 月 2 日 15 点 04 分 05 秒），不是 C++ 的 `%Y-%m-%d %H:%M:%S`。

### 7.2 解析与运算

```go
// 解析字符串
t, err := time.Parse("2006-01-02", "2026-08-09")
if err != nil {
    log.Fatal(err)
}

// 时间运算
later := now.Add(2 * time.Hour)     // 加 2 小时
before := now.AddDate(0, -1, 0)     // 减 1 个月
diff := later.Sub(now)              // Duration（差值）
fmt.Println(diff)                   // 2h0m0s

// Duration 运算
d := 90 * time.Second
fmt.Println(d.Minutes())            // 1.5
fmt.Println(d > time.Minute)        // true
```

### 7.3 定时与超时

```go
// 休眠（C++ sleep_for 对照）
time.Sleep(2 * time.Second)

// 定时器
timer := time.NewTimer(1 * time.Second)
<-timer.C  // 1 秒后收到
// 或 time.After(1 * time.Second)

// 周期执行（C++ 无直接对照）
ticker := time.NewTicker(500 * time.Millisecond)
defer ticker.Stop()
for range ticker.C {
    fmt.Println("tick")
    break // 演示只跑一次
}

// 时间戳
unix := time.Now().Unix()      // 秒
ms := time.Now().UnixMilli()   // 毫秒
```

---

## 八、常见坑

### 坑 1：2006 年格式化模板

```go
// ❌ C++ 习惯写法（错）
// now.Format("YYYY-MM-DD HH:MM:SS")  // 输出一堆数字，完全不对

// ✅ Go 写法
now.Format("2006-01-02 15:04:05")
```

### 坑 2：忘记关闭文件 / defer 顺序

```go
// ❌ 忘记关闭（句柄泄漏）
data, _ := os.ReadFile("x")  // 这个没问题（内部会关）
f, _ := os.Open("x")         // 这个必须关！
// 忘了 f.Close()

// ✅ 打开后立刻 defer
f, err := os.Open("x")
if err != nil {
    log.Fatal(err)
}
defer f.Close()
```

### 坑 3：字符串遍历用 range 下标是字节

```go
s := "你好go"
fmt.Println(len(s))        // 8（"你好"各 3 字节 + "go" 2 字节）
for i := 0; i < len(s); i++ {
    fmt.Printf("%c", s[i]) // ❌ 输出乱码！按字节取
}
// ✅ 用 range 按 rune 遍历
for _, r := range s {
    fmt.Printf("%c", r)    // 你好go
}
```

### 坑 4：循环里用 `+` 拼字符串

```go
// ❌ 10 万次拼接 = 大量内存分配，性能极差
s := ""
for i := 0; i < 100000; i++ {
    s += "x"
}
// ✅ strings.Builder
var sb strings.Builder
for i := 0; i < 100000; i++ {
    sb.WriteByte('x')
}
```

### 坑 5：os.Exit 不执行 defer

```go
func main() {
    defer fmt.Println("不会打印")
    os.Exit(1)  // defer 不执行！
}
// 需要"退出前清理"时，用 log.Fatal 也不行（同样 os.Exit）
// 正确做法：return 而不是 os.Exit
```

### 坑 6：time.Parse 的布局必须匹配格式

```go
// ❌ 布局与输入不一致
t, err := time.Parse("2006-01-02", "2026/08/09")  // err != nil

// ✅ 布局必须严格匹配输入
t, err = time.Parse("2006/01/02", "2026/08/09")
```

---

## 九、练习任务

- [ ] 用 `fmt` 输出一个结构体（`%v`、`%+v`、`%#v` 三种格式），观察差异
- [ ] 用 `strings.Builder` 拼接 10 万次字符串，并与 `+` 拼接做耗时对比（`time.Since`）
- [ ] 读取一个文本文件，统计每个单词出现次数（`strings.Fields` + map）
- [ ] 写一个 `copyFile(src, dst)` 函数，用 `io.Copy` 实现文件复制
- [ ] 用 `bufio.Scanner` 逐行读取一个大日志文件并打印行号
- [ ] 打印当前时间的 5 种不同格式（日期、时间、ISO、时间戳秒、毫秒）
- [ ] 写一个"每分钟打印一次当前时间"的程序（`time.Ticker`），跑 3 次退出

---

## 十、本节要点速查

| 包 | 常用 API | 要点 |
|----|----------|------|
| `fmt` | `Println` / `Printf` / `Sprintf` | `%v`、`%+v`、`%#v`、`%T`、`%d`、`%f` |
| `strings` | `Contains` / `Split` / `Join` / `Fields` / `TrimSpace` | string 不可变，操作都返回新串 |
| `strings.Builder` | `WriteString` / `String` | 大量拼接用它，别用 `+` |
| `os` | `ReadFile` / `WriteFile` / `Open` / `Getenv` | 打开后立刻 `defer Close()` |
| `io` | `ReadAll` / `Copy` / `MultiReader` | Reader/Writer 是数据流核心接口 |
| `bufio` | `NewReader` / `NewScanner` | 逐行/逐词读取 |
| `time` | `Now` / `Format` / `Parse` / `Sleep` / `Ticker` | 模板 `2006-01-02 15:04:05`，不是 `%Y` |

> 上一篇：[03-泛型generics](03-泛型generics.md) | 下一篇：[05-encoding-json与配置文件](05-encoding-json与配置文件.md)
