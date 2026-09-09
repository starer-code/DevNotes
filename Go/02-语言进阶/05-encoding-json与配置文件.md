# 05 - encoding/json 与配置文件

> 从 C++ 的 nlohmann/json 到 Go 的 encoding/json：结构体标签驱动的序列化

---

## 一、简述

Go 的 `encoding/json` 是标准库内置的 JSON 序列化/反序列化包。与 C++ 需要第三方库（nlohmann/json、rapidjson）不同，Go 通过**结构体字段标签（struct tag）**声明式地描述 JSON 映射关系，`json.Marshal` / `json.Unmarshal` 一键完成转换。

> **核心要点**：Go 的 JSON 哲学是"**结构体即 schema**"——先用结构体定义数据形状，标签控制字段名、可选性、忽略规则。这也让配置文件读写（JSON/YAML）变得极其自然。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| JSON 库 | nlohmann/json 等第三方 | `encoding/json` 标准库 | 开箱即用 |
| 对象映射 | `json j = json::parse(s)` | `json.Unmarshal(data, &v)` | 需要目标结构体 |
| 序列化 | `j.dump()` | `json.Marshal(v)` | 返回 []byte + error |
| 字段改名 | 手动构造 | struct tag `` `json:"name"` `` | 声明式 |
| 忽略字段 | 手动排除 | `` `json:"-"` `` | 标签控制 |
| 可选字段 | 无 | `omitempty` | 零值不输出 |
| 动态 JSON | `json::object()` / 数组 | `map[string]any` / `[]any` | 用 any 容器 |
| 配置文件 | Boost.PropertyTree / YAML 库 | 读 JSON 或第三方 YAML（gopkg.in/yaml.v3） | JSON 为主 |

---

## 三、序列化与反序列化

### 3.1 基本用法

```go
import (
    "encoding/json"
    "fmt"
)

type Person struct {
    Name string
    Age  int
}

func main() {
    p := Person{Name: "Tom", Age: 30}

    // 序列化：结构体 → JSON
    data, err := json.Marshal(p)
    if err != nil {
        panic(err)
    }
    fmt.Println(string(data))  // {"Name":"Tom","Age":30}

    // 反序列化：JSON → 结构体
    var p2 Person
    err = json.Unmarshal(data, &p2)
    if err != nil {
        panic(err)
    }
    fmt.Printf("%+v\n", p2)  // {Name:Tom Age:30}
}
```

### 3.2 结构体标签（关键）

```go
type Config struct {
    Server string `json:"server"`            // 字段名映射为 server
    Port   int    `json:"port"`              // 默认 0
    Debug  bool   `json:"debug,omitempty"`   // 零值时省略
    Secret string `json:"-"`                 // 永远不参与 JSON
    Tags   []string `json:"tags,omitempty"`  // 空切片省略
}

c := Config{Server: "localhost", Secret: "不输出"}
data, _ := json.Marshal(c)
fmt.Println(string(data))  // {"server":"localhost"}（port/debug/tags 省略，secret 忽略）
```

**标签规则**：

| 标签 | 效果 |
|------|------|
| `` `json:"name"` `` | 字段名映射为 `name` |
| `` `json:"name,omitempty"` `` | 零值（0/""/false/nil）时**不输出** |
| `` `json:"-"` `` | 完全忽略该字段 |
| `` `json:"-,"` `` | 字段名输出为 `-`（极少用） |
| 无标签 | 默认用字段原名（`Person.Name` → `"Name"`） |

### 3.3 大小写规则（坑点预警）

```go
type User struct {
    name string  // ❌ 小写字段：json 完全忽略它！
    Email string // ✅ 大写字段：可序列化
}
u := User{name: "x", Email: "a@b.com"}
data, _ := json.Marshal(u)
fmt.Println(string(data))  // {"Email":"a@b.com"} —— name 丢了！
```

> **Go 的可见性规则**：`encoding/json` 只能访问**导出字段（大写开头）**。小写字段会被静默忽略，不会有任何报错——这是最常见的坑。

---

## 四、JSON 与 map / 动态结构

### 4.1 map 序列化

```go
// map[string]any 序列化（键必须是字符串）
m := map[string]any{
    "name": "Tom",
    "age":  30,
    "tags": []string{"go", "cpp"},
}
data, _ := json.Marshal(m)
fmt.Println(string(data))
// {"age":30,"name":"Tom","tags":["go","cpp"]}

// 反序列化到 map
var result map[string]any
json.Unmarshal(data, &result)
fmt.Println(result["name"])  // Tom（any 类型，需要断言）
```

### 4.2 任意 JSON 解析

```go
// 解析未知结构的 JSON：map[string]any + 类型断言
raw := `{"a": 1, "b": [1,2,3], "c": {"d": "x"}}`
var obj map[string]any
json.Unmarshal([]byte(raw), &obj)

// 取值必须断言
a := obj["a"].(float64)  // JSON 数字默认是 float64！
fmt.Println(a)           // 1

// 嵌套
b := obj["b"].([]any)    // 数组是 []any
c := obj["c"].(map[string]any)
fmt.Println(c["d"])      // x
```

> **注意**：JSON 数字反序列化到 `any` 时是 `float64`（不是 int）——因为 JSON 只有一种数字类型。

### 4.3 通用 any 结构体

```go
type Response struct {
    Code int    `json:"code"`
    Msg  string `json:"msg"`
    Data any    `json:"data"`  // 动态数据
}
```

---

## 五、流式处理与编码器

### 5.1 json.Encoder / Decoder（流式）

```go
import (
    "encoding/json"
    "os"
)

// 流式写出（支持直接写文件 / HTTP 响应）
func writeJSON(path string, v any) error {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()

    enc := json.NewEncoder(f)
    enc.SetIndent("", "  ")  // 缩进美化（可选）
    return enc.Encode(v)
}

// 流式读入
func readJSON(path string, v any) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()

    dec := json.NewDecoder(f)
    return dec.Decode(v)
}
```

### 5.2 大 JSON 数组逐条处理

```go
// 100 万条记录的 JSON 数组，不能一次全读进内存 → 流式 Decoder
dec := json.NewDecoder(f)
// 读取开头的 [
if _, err := dec.Token(); err != nil {
    return err
}
for dec.More() {
    var item Item
    if err := dec.Decode(&item); err != nil {
        return err
    }
    process(item)  // 逐条处理
}
// 读取结尾的 ]
if _, err := dec.Token(); err != nil {
    return err
}
```

---

## 六、配置文件读写实战

### 6.1 JSON 配置文件（完整示例）

```go
// config.json
// {
//   "server": "0.0.0.0",
//   "port": 8080,
//   "database": {
//     "host": "localhost",
//     "user": "root",
//     "password": "123456"
//   },
//   "features": ["logging", "metrics"]
// }

type DatabaseConfig struct {
    Host     string `json:"host"`
    User     string `json:"user"`
    Password string `json:"password"`
}

type Config struct {
    Server   string         `json:"server"`
    Port     int            `json:"port"`
    Database DatabaseConfig `json:"database"`
    Features []string       `json:"features"`
}

func LoadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("读取配置失败: %w", err)
    }

    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("解析配置失败: %w", err)
    }

    // 可选：设置默认值（零值兜底）
    if cfg.Port == 0 {
        cfg.Port = 8080
    }
    return &cfg, nil
}

func main() {
    cfg, err := LoadConfig("config.json")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("服务: %s:%d\n", cfg.Server, cfg.Port)
}
```

### 6.2 YAML 配置（第三方）

```go
// go get gopkg.in/yaml.v3
import "gopkg.in/yaml.v3"

var cfg Config
data, _ := os.ReadFile("config.yaml")
yaml.Unmarshal(data, &cfg)  // 标签用 yaml:"xxx"，用法与 json 相同
```

---

## 七、常见坑

### 坑 1：小写字段被静默忽略

```go
type S struct {
    id   int    // ❌ 不会序列化，也不报错
    Name string // ✅ 这个才会输出
}
```

### 坑 2：JSON 数字到 any 是 float64

```go
var m map[string]any
json.Unmarshal([]byte(`{"age":30}`), &m)
// m["age"] 是 float64(30)，不是 int！
age := int(m["age"].(float64))  // 需要这样转换
```

### 坑 3：Marshal 的错误必须处理

```go
data, err := json.Marshal(v)
if err != nil {
    log.Fatalf("序列化失败: %v", err)
}
// 常见失败原因：结构体里有 channel / func / 循环引用
```

### 坑 4：Unmarshal 到 nil map / nil slice

```go
var m map[string]string
json.Unmarshal([]byte(`{"a":"1"}`), &m)  // ✅ 会自动创建

var s []int
json.Unmarshal([]byte(`[1,2]`), &s)      // ✅ 会自动创建

// 但 JSON 里没有对应字段时保持 nil，访问前要判断
```

### 坑 5：HTML 转义

```go
// json.Marshal 默认会转义 < > &（防 XSS）
data, _ := json.Marshal("<script>")
fmt.Println(string(data))  // "\u003cscript\u003e"

// 不需要转义时：
enc := json.NewEncoder(os.Stdout)
enc.SetEscapeHTML(false)
```

### 坑 6：time.Time 的 JSON 格式

```go
type Event struct {
    Time time.Time `json:"time"`
}
// 序列化结果: {"time":"2026-08-09T12:00:00+08:00"}（RFC3339）
// 反序列化同样支持 RFC3339 字符串
// 自定义格式：实现 MarshalJSON / UnmarshalJSON 方法
```

---

## 八、练习任务

- [ ] 定义 `User` 结构体（含 `json:"-"`、`omitempty`、自定义字段名标签），序列化并打印结果
- [ ] 把 `{"name":"Tom","age":30,"tags":["a","b"]}` 反序列化到结构体，验证未知字段的处理
- [ ] 实现一个 `LoadConfig` 加载 JSON 配置（含嵌套数据库配置），带默认值兜底
- [ ] 用 `json.Encoder` + `SetIndent` 把结构体美化输出到文件
- [ ] 写一个 `PrettyPrint(v any)` 函数：序列化后带缩进打印
- [ ] 实现 `Event` 结构体的自定义 `MarshalJSON`，把 time.Time 格式化为 `2006-01-02 15:04:05`
- [ ] 从 HTTP 响应 `resp.Body`（一个 Reader）直接 `json.NewDecoder(resp.Body).Decode(&v)`，不经过 []byte

---

## 九、本节要点速查

| 概念 | 要点 |
|------|------|
| 序列化 | `json.Marshal(v)` → []byte；`json.Unmarshal(data, &v)` → 结构体 |
| 结构体标签 | `` `json:"name,omitempty"` ``；`"-"` 忽略字段；无标签用字段原名 |
| 导出规则 | 小写字段**静默忽略**（不报错）——最常见的坑 |
| map/动态 | `map[string]any`；JSON 数字进 any 是 `float64` |
| 流式处理 | `json.NewEncoder(w)` / `json.NewDecoder(r)`，适合大文件/HTTP |
| 美化输出 | `enc.SetIndent("", "  ")` |
| HTML 转义 | 默认转义 `<>&`，不需要时 `enc.SetEscapeHTML(false)` |
| time.Time | 默认 RFC3339 格式；自定义走 `MarshalJSON` / `UnmarshalJSON` |
| 配置文件 | 结构体 + 默认值兜底；YAML 用 `gopkg.in/yaml.v3`（标签同理） |

> 上一篇：[04-标准库核心包-fmt-strings-os-io-time](04-标准库核心包-fmt-strings-os-io-time.md) | 下一篇：[06-类型断言与type-switch](06-类型断言与type-switch.md)
