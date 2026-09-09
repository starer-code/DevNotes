# 10 - 字符串与 Rune

> Go 字符串的本质、Unicode 处理与常用操作速查

---

## 一、简述

Go 的 `string` 是**不可变的字节序列**，底层以 UTF-8 编码存储。它是一个**值类型**（赋值和传参都会拷贝），长度固定后不能修改。

与 C++ `std::string` 最大的区别：

1. **不可变**——没有 `operator[]` 返回引用，不能就地修改字符
2. **UTF-8 原生支持**——但 `len()` 返回的是**字节数**，不是字符数
3. **`rune` 类型**——用于表示单个 Unicode 码点（`int32` 别名）

---

## 二、C++ 对照速查表

| Go | C++ | 说明 |
|----|-----|------|
| `string` | `std::string` | Go 是不可变值类型；C++ 可变 |
| `rune` | `char32_t` | `rune` = `int32`，表示一个 Unicode 码点 |
| `byte` | `uint8` / `unsigned char` | 一个字节 |
| `len(s)` | `s.size()` | Go 返回**字节数**，不是字符数 |
| `s[i]` | `s[i]` | Go 返回 `byte`；C++ 返回 `char&`（可写） |
| `for _, r := range s` | `for (char32_t c : s)` | Go 遍历 rune；C++ 依赖编码 |
| `strings.Builder` | `std::ostringstream` | 高效字符串拼接 |
| `strconv.Itoa(n)` | `std::to_string(n)` | 整数转字符串 |
| `strconv.Atoi(s)` | `std::stoi(s)` | 字符串转整数 |
| `strings.Contains` | `std::string::find` | 判断子串是否存在 |
| `[]byte(s)` | `reinterpret_cast` | 显式转换（会拷贝数据） |
| 没有隐式转换 | `std::string` 构造 | `string` 和 `[]byte` 必须显式转换 |

---

## 三、代码示例

### 3.1 string 底层：不可变字节序列

```go
package main

import "fmt"

func main() {
    s := "Hello, 世界"
    fmt.Println("len:", len(s))  // 13（字节数！不是字符数）

    // s[0] = 'h'  // 编译错误！字符串不可变

    // 底层就是字节数组的只读视图
    b := []byte(s) // 转为 []byte 后可修改
    b[0] = 'h'
    s2 := string(b) // 再转回 string
    fmt.Println(s2) // hello, 世界
}
```

### 3.2 rune 类型与 byte vs rune

```go
package main

import "fmt"

func main() {
    s := "Go语言"

    // byte —— 字节视角
    fmt.Println("字节数:", len(s))          // 9（G=1, o=1, 语=3, 言=3）

    // rune —— 字符视角
    runes := []rune(s)
    fmt.Println("字符数:", len(runes))      // 4

    // 每个 rune 是一个 int32，代表一个 Unicode 码点
    fmt.Printf("语 的 Unicode: U+%04X\n", runes[2]) // U+8BED
}
```

### 3.3 遍历字符串：range vs 索引

```go
package main

import "fmt"

func main() {
    s := "Hello世界"

    // 方式一：for range —— 按 rune 遍历（推荐用于字符级操作）
    fmt.Println("=== for range ===")
    for i, r := range s {
        fmt.Printf("字节索引 %d, rune: %c (U+%04X)\n", i, r, r)
    }
    // 输出：H(0), e(1), l(2), l(3), o(4), 世(5), 界(8)
    // 注意：i 是字节索引！"世"从第5字节开始，占3字节，"界"从第8字节开始

    // 方式二：for i —— 按字节遍历
    fmt.Println("=== for i (字节) ===")
    for i := 0; i < len(s); i++ {
        fmt.Printf("s[%d] = 0x%02X\n", i, s[i])
    }
    // 中文字符的字节是 0xE4 0xB8 0xAD 这样的三字节序列

    // 方式三：转为 []rune 后按索引遍历
    r := []rune(s)
    for i := 0; i < len(r); i++ {
        fmt.Printf("r[%d] = %c\n", i, r[i])
    }
}
```

### 3.4 utf8 包

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func main() {
    s := "Go语言"

    // 获取 rune 数量（等价于 len([]rune(s)) 但更高效）
    fmt.Println("字符数:", utf8.RuneCountInString(s)) // 4

    // 验证是否为合法 UTF-8
    fmt.Println("合法 UTF-8:", utf8.ValidString(s)) // true

    // 非法 UTF-8 字节
    bad := []byte{0xCE, 0xBA, 0xE1, 0xBD, 0xB9, 0xCF, 0x83, 0xCE, 0xBC, 0xCE, 0xB5}
    fmt.Println("合法:", utf8.Valid(bad)) // false

    // RuneLen 返回某个 rune 编码后占多少字节
    fmt.Println("语 占字节:", utf8.RuneLen('语')) // 3
}
```

### 3.5 strings 包常用函数

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    s := "  Hello, Go World!  "

    // 查找
    fmt.Println(strings.HasPrefix(s, "  Hello")) // true
    fmt.Println(strings.HasSuffix(s, "!  "))     // true
    fmt.Println(strings.Contains(s, "Go"))       // true
    fmt.Println(strings.Index(s, "Go"))          // 10（字节索引）

    // 裁剪
    fmt.Println(strings.TrimSpace(s))            // "Hello, Go World!"
    fmt.Println(strings.Trim(s, " !"))           // "Hello, Go World"
    fmt.Println(strings.TrimLeft(s, " H"))       // "ello, Go World!  "
    fmt.Println(strings.TrimSuffix("test.go", ".go")) // "test"
    fmt.Println(strings.TrimPrefix("cmd/test.go", "cmd/")) // "test.go"

    // 替换
    fmt.Println(strings.Replace("aabbcc", "bb", "xx", 1))  // "aaxxcc" (只替换1次)
    fmt.Println(strings.ReplaceAll("aabbcc", "a", "x"))     // "xxbbcc" (替换所有)
    fmt.Println(strings.ReplaceAll("aabbcc", "bb", ""))     // "aacc" (删除子串)

    // 分割与合并
    parts := strings.Split("a,b,c", ",")   // ["a", "b", "c"]
    joined := strings.Join(parts, "-")      // "a-b-c"
    fmt.Println(joined)

    // 大小写
    fmt.Println(strings.ToUpper("hello"))   // "HELLO"
    fmt.Println(strings.ToLower("HELLO"))   // "hello"
    fmt.Println(strings.Title("hello go"))  // "Hello Go" (1.18 后建议用 cases)

    // 重复与填充
    fmt.Println(strings.Repeat("ab", 3))    // "ababab"
    fmt.Println(strings.Repeat("=", 20))    // "===================="

    // 字段分割（按空白字符）
    fields := strings.Fields("  foo   bar  baz  ")
    fmt.Println(fields) // [foo bar baz]
}
```

### 3.6 strconv 包：类型转换

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // ---- 整数 ----
    // int -> string
    fmt.Println(strconv.Itoa(42))        // "42"
    fmt.Println(strconv.FormatInt(255, 2))  // "11111111" (二进制)

    // string -> int
    n, err := strconv.Atoi("42")
    if err != nil {
        fmt.Println("转换失败:", err)
    } else {
        fmt.Println(n) // 42
    }

    // 更灵活的解析
    n2, _ := strconv.ParseInt("FF", 16, 64) // 十六进制 -> int64
    fmt.Println(n2) // 255

    // ---- 布尔 ----
    b, _ := strconv.ParseBool("true")
    fmt.Println(b) // true
    fmt.Println(strconv.FormatBool(true)) // "true"

    // ---- 浮点数 ----
    f, _ := strconv.ParseFloat("3.14159", 64)
    fmt.Println(f) // 3.14159

    // 浮点数格式化
    fmt.Println(strconv.FormatFloat(3.14159, 'f', 2, 64))  // "3.14"
    fmt.Println(strconv.FormatFloat(0.15, 'f', 10, 64))    // "0.1500000000"
    fmt.Println(strconv.FormatFloat(3.14159, 'e', 4, 64))  // "3.1416e+00"
}
```

### 3.7 string 与 []byte 的转换

```go
package main

import "fmt"

func main() {
    s := "你好世界"

    // string -> []byte（拷贝！底层数组不共享）
    b := []byte(s)
    b[0] = 'x' // 修改不影响原字符串
    fmt.Println(string(b)) // "x好世界"
    fmt.Println(s)         // "你好世界"（原字符串不变）

    // string -> []rune（按字符拆分）
    r := []rune(s)
    r[0] = '我'
    fmt.Println(string(r)) // "我好世界"

    // 频繁转换的性能提示：
    // 如果需要反复读取 []byte，先转换一次再复用，不要反复转
}
```

### 3.8 字符串拼接：三种方式

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    // ---- 方式一：+ 运算符（简单场景，少量拼接） ----
    hello := "Hello" + ", " + "World!"
    fmt.Println(hello)

    // 注意：每次 + 都会分配新内存并拷贝
    // 循环中使用 + 拼接性能差（O(n^2)）

    // ---- 方式二：strings.Builder（推荐，高效） ----
    var builder strings.Builder
    builder.Grow(100) // 预分配容量（可选但推荐）

    for i := 0; i < 10; i++ {
        builder.WriteString(fmt.Sprintf("item%d ", i))
    }
    result := builder.String()
    fmt.Println(result) // "item0 item1 item2 ... item9 "

    // 也可以用 WriteByte, WriteRune
    builder.Reset()
    builder.WriteString("Go")
    builder.WriteByte('!')
    fmt.Println(builder.String()) // "Go!"

    // ---- 方式三：strings.Join（拼接已有切片） ----
    items := []string{"apple", "banana", "cherry"}
    joined := strings.Join(items, " | ")
    fmt.Println(joined) // "apple | banana | cherry"
}
```

### 3.9 fmt.Sprintf 格式化

```go
package main

import "fmt"

func main() {
    // 基本格式化
    fmt.Printf("整数: %d, 浮点: %f, 字符串: %s\n", 42, 3.14, "hello")

    // Sprintf 返回字符串而非打印
    s := fmt.Sprintf("年龄: %d, 成绩: %.1f%%", 18, 95.5)
    fmt.Println(s) // "年龄: 18, 成绩: 95.5%"

    // 常用格式动词
    fmt.Printf("十进制: %d\n", 255)
    fmt.Printf("八进制: %o\n", 255)      // 377
    fmt.Printf("十六进制: %x\n", 255)    // ff
    fmt.Printf("十六进制(大写): %X\n", 255) // FF
    fmt.Printf("二进制: %b\n", 255)      // 11111111
    fmt.Printf("Unicode: %U\n", '语')    // U+8BED
    fmt.Printf("字符: %c\n", 8364)       // € (欧元符号)

    // 宽度与对齐
    fmt.Printf("[%10s]\n", "right")   // [     right]
    fmt.Printf("[%-10s]\n", "left")   // [left      ]
    fmt.Printf("[%05d]\n", 42)        // [00042]

    // 结构体格式化
    type Person struct {
        Name string
        Age  int
    }
    p := Person{"Alice", 30}
    fmt.Printf("%+v\n", p)  // {Name:Alice Age:30}
    fmt.Printf("%#v\n", p)  // main.Person{Name:"Alice", Age:30}
    fmt.Printf("%T\n", p)   // main.Person

    // 错误处理常用
    err := fmt.Errorf("文件 %s 不存在 (行号: %d)", "config.txt", 42)
    fmt.Println(err)
}
```

### 3.10 多行字符串

```go
package main

import "fmt"

func main() {
    // ---- 反引号：原生字符串（推荐） ----
    // 不能包含反引号本身，不处理转义符
    raw := `
    第一行
    第二行（有缩进）
    \n 这不是换行，是字面量
    `
    fmt.Println(raw)

    // ---- 双引号 + 转义 ----
    escaped := "第一行\n第二行\n\t\t缩进\n路径: C:\\Users\\test"
    fmt.Println(escaped)

    // 反引号常用于：正则、SQL、模板、路径
    regex := `^\d{3}-\d{4}$`
    fmt.Println(regex) // 不需要转义反斜杠
}
```

---

## 四、常见坑

### 坑 1：len() 返回字节数，不是字符数

```go
s := "你好"
fmt.Println(len(s))    // 6，不是 2！
fmt.Println(utf8.RuneCountInString(s)) // 2（正确获取字符数）
```

**教训**：涉及中文等多字节字符时，用 `utf8.RuneCountInString()` 或 `len([]rune(s))`。

### 坑 2：for range 中 i 是字节索引

```go
s := "abc你好"
for i, r := range s {
    fmt.Printf("i=%d char=%c\n", i, r)
}
// i=0 a, i=1 b, i=2 c, i=3 你, i=6 好
// "你"从第3字节开始，占3字节，所以下一个是6不是4
```

**教训**：不要假设连续 rune 的索引是连续的。如果需要"第 N 个字符"，先转 `[]rune`。

### 坑 3：字符串不可变

```go
s := "hello"
// s[0] = 'H'  // 编译错误：cannot assign to s[0]
// 修改方式：转 []byte -> 修改 -> 转回 string（会拷贝）
```

### 坑 4：string 和 []byte 转换会拷贝数据

```go
s := "hello"
b := []byte(s) // 拷贝！
b[0] = 'H'
fmt.Println(s) // "hello"（不受影响）

// C++ 开发者的直觉：以为修改 b 会影响 s
// 实际上 Go 中两者底层数组完全独立
```

### 坑 5：strings.Builder 用完后不要再修改

```go
var b strings.Builder
b.WriteString("hello")
s := b.String()
// b.WriteString(" world") // 不推荐：String() 会返回已构建的字符串，但修改 builder 后 s 不会变
// 如果需要继续修改，必须在 String() 之前完成所有写入

// 正确做法：String() 之后调用 Reset() 再使用
b.Reset()
b.WriteString("new content")
```

### 坑 6：空字符串 "" 不是 nil

```go
var s string          // s 是 ""（零值），不是 nil
fmt.Println(s == "")  // true

var p *string         // 这才是 nil
fmt.Println(p == nil)  // true
// p 和 s 是不同类型：string vs *string
```

### 坑 7：字符串比较

```go
a, b := "abc", "abd"
fmt.Println(a == b)          // false（可以用 ==）
// fmt.Println(a < b)        // 编译错误！Go 不支持字符串用 < > 比较

// 需要显式用 strings.Compare（返回 -1, 0, 1）
import "strings"
fmt.Println(strings.Compare(a, b)) // -1（a < b 按字典序）

// 注意：比较是按字节（UTF-8 编码值）进行的
fmt.Println(strings.Compare("a", "b"))  // -1
fmt.Println(strings.Compare("你", "我")) // 按 UTF-8 字节序比较
```

### 坑 8：strings.TrimSpace 与中文空格

```go
s := " Hello "
fmt.Println(strings.TrimSpace(s)) // "Hello"（只去除 ASCII 空格/制表符/换行）

// \u3000（中文全角空格）不会被 TrimSpace 去除
cn := "\u3000你好\u3000"
fmt.Println(strings.TrimSpace(cn)) // "\u3000你好\u3000"（没变化！）

// 需要手动去除：strings.Trim(s, " \t\r\n\u3000")
```

---

## 五、练习任务

- [ ] 编写函数 `CountChars(s string) int`，返回字符串的 rune 数量（不使用 `len([]rune(s))`，用 `utf8` 包实现）
- [ ] 编写函数 `Reverse(s string) string`，反转字符串（注意正确处理多字节字符，不能简单 `[]byte` 反转）
- [ ] 编写函数 `IsASCII(s string) bool`，判断字符串是否只包含 ASCII 字符
- [ ] 用 `strings.Builder` 实现一个函数，将 `[]int` 拼接成逗号分隔的字符串，如 `[1,2,3]` -> `"1,2,3"`
- [ ] 编写函数 `SafeIndex(s string, index int) (rune, bool)`，按字符索引安全取值（越界返回零值和 false）
- [ ] 编写函数 `WordCount(s string) map[string]int`，统计字符串中各单词出现次数（用 `strings.Fields` 分割）
- [ ] 编写函数 `PadLeft(s string, length int, pad rune) string`，左填充字符串到指定长度
- [ ] 实现一个简单的 CSV 解析函数：输入 `"a,b,c"` 输出 `[]string{"a","b","c"}`，处理空字段和引号包裹的字段

---

## 六、关键规则速记

| 场景 | 做法 |
|------|------|
| 获取字符数量 | `utf8.RuneCountInString(s)` |
| 按字符遍历 | `for i, r := range s` |
| 按字符索引 | 先 `r := []rune(s)` 再 `r[i]` |
| 字符串拼接（少量） | `+` 运算符 |
| 字符串拼接（大量/循环） | `strings.Builder` |
| 拼接切片 | `strings.Join` |
| int 转 string | `strconv.Itoa(n)` |
| string 转 int | `strconv.Atoi(s)`（失败返回 error） |
| 格式化输出 | `fmt.Sprintf` / `fmt.Printf` |
| 高效读取 []byte | 转一次 `[]byte` 复用，不反复转换 |
