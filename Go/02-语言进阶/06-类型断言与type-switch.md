# 06 - 类型断言与 type-switch

> 从 C++ 的 dynamic_cast / typeid 到 Go 的类型断言、类型开关与反射初探

---

## 一、简述

接口变量在运行时存储了"动态类型"。当我们需要**把接口值还原成具体类型**、或**按不同类型走不同逻辑**时，就用类型断言（type assertion）和类型开关（type switch）。

> **核心要点**：Go 类型断言是 `x.(T)` 语法——它是"安全的 dynamic_cast"：带 `ok` 判断时永远不会 panic。类型开关 `switch v := x.(type)` 则是处理"未知类型集合"最优雅的方式。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 向下转型 | `dynamic_cast<T*>(ptr)` | `v, ok := x.(T)` | Go 更简洁，双返回值 |
| 不安全转型 | `static_cast` / `reinterpret_cast` | `v := x.(T)` | Go 会 panic（不推荐） |
| 类型判断 | `typeid(x) == typeid(T)` | `x.(type)`（type switch） | 语法不同 |
| 类型名称 | `typeid(x).name()` | `fmt.Sprintf("%T", x)` | 运行时类型名 |
| 反射 | RTTI / `<typeinfo>` | `reflect` 包 | 用法差异大 |

---

## 三、类型断言基础

### 3.1 语法与两种形式

```go
var x any = 42

// 形式一：带 ok（推荐，安全）
v, ok := x.(int)
if ok {
    fmt.Println("是 int:", v)  // 42
} else {
    fmt.Println("不是 int")
}

// 形式二：不带 ok（不推荐，失败直接 panic）
v2 := x.(int)      // ✅ 成功
// v3 := x.(string)  // ❌ panic: interface conversion
```

> **规则**：永远用带 `ok` 的形式。不带 ok 的写法相当于 C++ 的 `static_cast`——假设你知道类型，错了就崩。

### 3.2 断言到接口

```go
// 断言到接口：检查是否实现了某接口
var x any = "hello"

if s, ok := x.(fmt.Stringer); ok {
    fmt.Println("实现了 Stringer:", s.String())
}

// 常用场景：error 接口断言具体错误类型
var err error = &MyError{Code: 404}
if e, ok := err.(*MyError); ok {
    fmt.Println("状态码:", e.Code)
}
```

---

## 四、type switch —— 类型开关

### 4.1 基本用法

```go
func describe(x any) string {
    switch v := x.(type) {   // 注意：x.(type) 只能用在 switch 里！
    case int:
        return fmt.Sprintf("整数 %d", v)   // v 已被推断为 int
    case string:
        return fmt.Sprintf("字符串 %q", v) // v 是 string
    case bool:
        return fmt.Sprintf("布尔 %v", v)
    case []int:
        return fmt.Sprintf("int 切片 %v", v)
    case nil:
        return "nil"
    default:
        return fmt.Sprintf("未知类型 %T", x)
    }
}

func main() {
    fmt.Println(describe(42))         // 整数 42
    fmt.Println(describe("hi"))       // 字符串 "hi"
    fmt.Println(describe(true))       // 布尔 true
    fmt.Println(describe([]int{1,2})) // int 切片 [1 2]
}
```

> **关键点**：`case` 分支里 `v` 自动是**该分支的具体类型**，不需要再断言。这是 type switch 相对 if-else 断言链的最大优势。

### 4.2 多个类型合并分支

```go
switch v := x.(type) {
case int, int32, int64:
    fmt.Println("整数族:", v)  // 此时 v 仍是 any 类型（多类型分支无法推断）
case string:
    fmt.Println("字符串:", v)  // 单一类型分支，v 是 string
}
```

### 4.3 带初始化的 type switch

```go
switch v := getValue().(type) {
case nil:
    fmt.Println("nil")
default:
    fmt.Printf("类型=%T 值=%v\n", v, v)
}
```

---

## 五、实战场景

### 5.1 场景一：处理异构数据（JSON / 配置）

```go
// 解析动态 JSON 后按类型处理
raw := `{"count": 3, "name": "tom", "ok": true}`
var data map[string]any
json.Unmarshal([]byte(raw), &data)

for key, value := range data {
    switch v := value.(type) {
    case float64:
        fmt.Printf("%s 是数字: %.0f\n", key, v)  // JSON 数字是 float64
    case string:
        fmt.Printf("%s 是字符串: %s\n", key, v)
    case bool:
        fmt.Printf("%s 是布尔: %v\n", key, v)
    default:
        fmt.Printf("%s 是其他: %T\n", key, v)
    }
}
```

### 5.2 场景二：错误类型分发

```go
func handleError(err error) {
    switch e := err.(type) {
    case *os.PathError:
        fmt.Printf("路径错误: %s (%v)\n", e.Path, e.Err)
    case *net.DNSError:
        fmt.Printf("DNS 错误: %s\n", e.Name)
    case *MyHTTPError:
        fmt.Printf("HTTP 错误: %d\n", e.StatusCode)
    default:
        fmt.Println("未知错误:", err)
    }
}
```

### 5.3 场景三：接口能力探测（type switch + interface 断言）

```go
// 检查对象是否具备某能力，再调用（类似 C++ dynamic_cast 到派生接口）
func process(obj any) {
    switch v := obj.(type) {
    case interface{ Run() }:
        v.Run()  // 有这个能力的类型才执行
    case interface{ String() string }:
        fmt.Println("可字符串化:", v.String())
    default:
        fmt.Println("无特殊能力")
    }
}
```

### 5.4 场景四：泛型 + type switch 综合实战

泛型负责"类型参数"，type switch 负责"运行时分支"，两者结合可写出既类型安全又灵活的代码：

```go
// 泛型函数 + type switch：把任意值格式化成"可读字符串"
func formatValue[T any](v T) string {
    switch x := any(v).(type) {   // T 转 any 后才能 type switch
    case int, int64, float64:
        return fmt.Sprintf("数值: %v", x)
    case string:
        return fmt.Sprintf("文本: %q", x)
    case bool:
        if x {
            return "是"
        }
        return "否"
    case []string:
        return fmt.Sprintf("列表: %v", strings.Join(x, ", "))
    default:
        return fmt.Sprintf("%T", x)  // 兜底打印类型名
    }
}

func main() {
    fmt.Println(formatValue(42))            // 数值: 42
    fmt.Println(formatValue(3.14))          // 数值: 3.14
    fmt.Println(formatValue("hello"))       // 文本: "hello"
    fmt.Println(formatValue(true))          // 是
    fmt.Println(formatValue([]string{"a", "b"})) // 列表: a, b
    fmt.Println(formatValue(time.Now()))    // time.Time（走 default）
}
```

> **对照 C++**：这相当于 `std::visit` + 重载的组合，但 Go 用 `any` + type switch 实现更直观。注意 `case int, int64, float64` 多类型分支里 `x` 是 `any`，无法调用类型特有方法，只能 `%v` 打印。

---

## 六、reflect 反射（进阶了解）

大部分场景用断言/type switch 就够；反射用于"完全未知的结构"（如通用序列化器、ORM、依赖注入）。

```go
import "reflect"

func inspect(v any) {
    t := reflect.TypeOf(v)
    val := reflect.ValueOf(v)

    fmt.Println("类型名:", t.Name())       // Person
    fmt.Println("类型种类:", t.Kind())     // struct

    // 遍历结构体字段
    for i := 0; i < t.NumField(); i++ {
        field := t.Field(i)
        value := val.Field(i)
        fmt.Printf("字段 %s: %v (标签 %q)\n",
            field.Name, value.Interface(), field.Tag)
    }
}

type Person struct {
    Name string `json:"name"`
    Age  int    `json:"age"`
}

func main() {
    inspect(Person{Name: "Tom", Age: 30})
}
```

> **注意**：反射性能差、可读性差，**能用类型断言解决的不用反射**。反射值必须是大写导出字段才能 `Interface()`。

---

## 七、常见坑

### 坑 1：不带 ok 的断言 panic

```go
var x any = 42
// s := x.(string)  // ❌ panic: interface conversion

// ✅ 永远带 ok
s, ok := x.(string)
if !ok {
    fmt.Println("不是 string")
}
```

### 坑 2：type switch 不能用于非接口类型

```go
// x.(type) 只能用于接口类型（any / interface{} / 自定义接口）
var x int = 42
// switch v := x.(type) { }  // ❌ 编译错误！x 不是接口类型
// 必须先转成接口：
switch v := any(x).(type) {
case int:
    fmt.Println("int:", v)
}
```

### 坑 3：多类型分支里 v 仍是 any

```go
switch v := x.(type) {
case int, string:  // 合并分支
    // v 是 any，不能用 int 的方法
    // fmt.Println(v + 1)  // ❌ 编译错误
    fmt.Printf("%T %v\n", v, v)
}
```

### 坑 4：断言到指针 vs 值

```go
var x any = &Person{Name: "Tom"}

// 断言成 Person（值）会失败！
_, ok := x.(Person)      // false（实际存的是 *Person）
p, ok := x.(*Person)     // ✅ true
```

### 坑 5：nil 接口断言

```go
var x any = nil
v, ok := x.(int)   // ok = false，不会 panic
fmt.Println(v, ok) // 0 false

// 但直接断言 nil 为具体类型：
// var p *int
// v, ok := any(p).(int)  // false（类型是 *int）
```

---

## 八、练习任务

- [ ] 写 `describe(x any) string`，用 type switch 处理 `int / string / bool / []string / nil / 其他` 六种情况
- [ ] 演示带 ok 和不带 ok 的类型断言，说明 panic 场景
- [ ] 解析 `{"a":1,"b":"x","c":true,"d":[1,2]}` 到 `map[string]any`，用 type switch 逐字段打印类型和值
- [ ] 用 type switch 实现 `formatValue(v any) string`：数字保留 2 位小数、字符串加引号、bool 转 yes/no
- [ ] 定义 `Sayer` 接口（`Say() string`），用 type switch 判断并调用实现了它的类型
- [ ] 用 `reflect` 打印任意结构体的字段名、类型、值（进阶题）
- [ ] 自定义一个错误类型，用 type switch 在 `handleError` 中做具体分支处理

---

## 九、本节要点速查

| 概念 | 要点 |
|------|------|
| 类型断言 | `v, ok := x.(T)` —— **永远带 ok**，不带 ok 失败会 panic |
| 断言到接口 | `x.(fmt.Stringer)` 检查是否实现某接口 |
| type switch | `switch v := x.(type)` —— `v` 在各分支自动是具体类型 |
| 使用前提 | `x.(type)` 只能用于**接口类型**，非接口先 `any(x)` 转换 |
| 多类型分支 | `case int, string:` 里 `v` 仍是 any，无法用类型特有方法 |
| 常见用途 | JSON 异构解析、错误类型分发、能力探测 |
| 反射 reflect | `reflect.TypeOf/ValueOf`，处理完全未知结构；性能差，少用 |
| 与泛型结合 | 泛型管编译期类型，type switch 管运行时分支，可组合 |
| 大坑 | 断言到值 vs 指针不匹配、nil 断言、多类型分支丢类型 |

> 上一篇：[05-encoding-json与配置文件](05-encoding-json与配置文件.md) | 下一篇：[01-goroutine](../03-并发编程/01-goroutine.md)
