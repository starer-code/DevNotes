# 05 - Map（哈希表）

> Go 的内置关联容器，键值对存储，底层是哈希表

---

## 一、概述

`map` 是 Go 的内置数据结构，用于存储键值对。它等价于 C++ 的 `std::unordered_map`——基于哈希表实现，**不是**红黑树（Go 没有 `std::map` 那样的有序容器）。

核心特性：
- 引用类型，赋值和传参共享底层数组
- 键必须支持 `==` 比较（可哈希）
- 遍历顺序不确定（哈希表特性）
- 并发读写会触发 **fatal**（不是 data race，直接崩程序）

---

## 二、C++ 对照速查表

| Go | C++ | 说明 |
|----|-----|------|
| `map[K]V` 类型声明 | `std::unordered_map<K,V>` 类型声明 | 声明一个 map 类型 |
| `m := map[string]int{}` | `auto m = unordered_map<string,int>();` | 字面量初始化 |
| `m := make(map[string]int)` | `auto m = unordered_map<string,int>();` | make 初始化 |
| `m := make(map[string]int, 64)` | `auto m = unordered_map<string,int>(64);` | 预分配容量 |
| `m["key"] = 42` | `m["key"] = 42;` | 插入/修改 |
| `delete(m, "key")` | `m.erase("key");` | 删除键 |
| `val, ok := m["key"]` | `auto it = m.find("key"); it != m.end()` | 查找（双返回值） |
| `len(m)` | `m.size()` | 获取大小 |
| `nil map` | `nullptr` 的 map | 未初始化的 map |
| `for k, v := range m` | `for (auto& [k, v] : m)` | 遍历 |
| **无** | `std::map<K,V>` | Go 没有有序 map |

---

## 三、声明与初始化

### 3.1 字面量初始化（最常用）

```go
package main

import "fmt"

func main() {
    // 字面量初始化：声明 + 赋值一步到位
    ages := map[string]int{
        "Alice": 30,
        "Bob":   25,
        "Carol": 28,
    }
    fmt.Println(ages) // map[Alice:30 Bob:25 Carol:28]

    // 空 map
    empty := map[string]int{}
    fmt.Println(len(empty)) // 0
}
```

### 3.2 make 初始化

```go
// make 创建空 map，可选预分配容量（提高性能）
scores := make(map[string]int)       // 零值容量
scores2 := make(map[string]int, 64)  // 预分配 64 个槽位

// 适用场景：已知大致大小，预分配可减少扩容次数
users := make(map[int]string, 1000)
```

### 3.3 nil map（未初始化）

```go
var m map[string]int // nil map，值为 nil
fmt.Println(m)       // map[]
fmt.Println(len(m))  // 0 — len 对 nil map 返回 0
```

### 3.4 C++ 对照

| Go | C++ |
|----|-----|
| `ages := map[string]int{"Alice": 30}` | `auto ages = unordered_map<string,int>{{"Alice", 30}};` |
| `m := make(map[string]int)` | `auto m = unordered_map<string,int>();` |
| `m := make(map[string]int, 64)` | `auto m = unordered_map<string,int>(64);` |
| `var m map[string]int` (nil) | `unordered_map<string,int>* m = nullptr;` |

---

## 四、增删改查

### 4.1 增 / 改（赋值）

```go
m := map[string]int{}

// 不存在的 key → 插入
m["apple"] = 5
m["banana"] = 3

// 已存在的 key → 修改
m["apple"] = 10

fmt.Println(m) // map[apple:10 banana:3]
```

### 4.2 查（双返回值 ok 模式）

```go
m := map[string]int{"x": 1, "y": 2}

// 双返回值：值 + 是否存在（ok 模式）
val, ok := m["x"]
fmt.Println(val, ok) // 1 true

val2, ok2 := m["z"]
fmt.Println(val2, ok2) // 0 false（零值，不存在）

// C++ 对比：
// auto it = m.find("x");
// if (it != m.end()) { /* 找到 */ }
```

> **为什么需要 ok 模式？** 如果值类型是 `int`，零值是 `0`，无法区分"值为 0"和"不存在"。`ok` 布尔值解决了这个问题。

### 4.3 删

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}

// delete 内置函数
delete(m, "b")
fmt.Println(m) // map[a:1 c:3]

// 删除不存在的 key → 静默忽略，不报错
delete(m, "z") // 没事
```

### 4.4 检查 key 是否存在

```go
m := map[string]int{"hello": 42}

if v, ok := m["hello"]; ok {
    fmt.Println("存在:", v) // 存在: 42
} else {
    fmt.Println("不存在")
}
```

---

## 五、遍历

### 5.1 for range 遍历

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}

// 遍历所有键值对
for k, v := range m {
    fmt.Printf("key=%s, value=%d\n", k, v)
}

// 只要 key
for k := range m {
    fmt.Println(k)
}

// 只要 value（用 _ 忽略 key）
for _, v := range m {
    fmt.Println(v)
}
```

### 5.2 顺序不确定（重要）

```go
// 多次运行，输出顺序可能不同！
m := map[int]string{1: "一", 2: "二", 3: "三"}
for k, v := range m {
    fmt.Println(k, v)
}
// 第一次: 2 二 / 1 一 / 3 三
// 第二次: 3 三 / 2 二 / 1 一
// 顺序是随机的，不要依赖它
```

### 5.3 如果需要有序遍历

```go
m := map[string]int{"c": 3, "a": 1, "b": 2}

// 先把 key 提取到切片，排序后再遍历
keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
sort.Strings(keys) // 需要 import "sort"

for _, k := range keys {
    fmt.Printf("%s: %d\n", k, m[k])
}
// 输出: a: 1 / b: 2 / c: 3（有序）
```

---

## 六、Key 的类型要求

map 的 key 必须支持 `==` 比较运算符（可哈希）。

### 6.1 可以做 key 的类型

| 类型 | 示例 |
|------|------|
| 基本类型 | `int`, `string`, `float64`, `bool`, `byte` |
| 指针 | `*int`, `*Struct` |
| 数组 | `[3]int`（元素类型也必须可比较） |
| struct（所有字段可比较） | `struct{ X, Y int }` |
| interface | 动态类型必须可比较 |

### 6.2 不能做 key 的类型

| 类型 | 原因 |
|------|------|
| 切片 `[]int` | 不可比较（长度不确定） |
| map | 不可比较（只和 `nil` 比较） |
| 函数 `func()` | 不可比较 |

```go
// 正确：基本类型做 key
m1 := map[int]string{1: "one"}
m2 := map[string]bool{"ok": true}

// 正确：struct 做 key（所有字段可比较）
type Point struct{ X, Y int }
m3 := map[Point]string{{1, 2}: "A", {3, 4}: "B"}

// 正确：指针做 key（比较的是地址）
m4 := map[*int]string{}

// 编译错误：切片不能做 key
// m5 := map[[]int]string{} // error: invalid map key type []int
```

---

## 七、Map 是引用类型

### 7.1 赋值共享底层数组

```go
original := map[string]int{"a": 1}
copy := original // copy 和 original 指向同一个底层 map

copy["b"] = 2
fmt.Println(original) // map[a:1 b:2] — original 也变了！
```

### 7.2 传参共享

```go
func modify(m map[string]int) {
    m["new_key"] = 999 // 直接修改调用者的 map
}

func main() {
    m := map[string]int{"x": 1}
    modify(m)
    fmt.Println(m) // map[new_key:999 x:1] — 被改了
}

// C++ 对比：传引用才有类似效果
// void modify(unordered_map<string,int>& m) { m["key"] = 999; }
```

### 7.3 如果需要独立副本（深拷贝）

```go
original := map[string]int{"a": 1, "b": 2}

// 手动拷贝
clone := make(map[string]int, len(original))
for k, v := range original {
    clone[k] = v
}
clone["c"] = 3

fmt.Println(original) // map[a:1 b:2] — 不受影响
fmt.Println(clone)    // map[a:1 b:2 c:3]
```

---

## 八、sync.Map 简介

Go 的普通 map **不是并发安全**的。并发读写会直接 fatal，不是 data race 竞态警告。

### 8.1 问题演示

```go
// 这段代码会 crash
m := map[string]int{}
go func() {
    for {
        m["key"] = 1 // 写
    }
}()
go func() {
    for {
        _ = m["key"] // 读
    }
}()
// fatal error: concurrent map read and map write
```

### 8.2 sync.Map 方案

```go
import "sync"

func main() {
    var m sync.Map

    // 存储
    m.Store("key1", 100)
    m.Store("key2", 200)

    // 读取（双返回值）
    val, ok := m.Load("key1")
    if ok {
        fmt.Println(val.(int)) // 100（需要类型断言）
    }

    // 删除
    m.Delete("key2")

    // 遍历
    m.Range(func(key, value any) bool {
        fmt.Printf("key=%v, value=%v\n", key, value)
        return true // 返回 false 停止遍历
    })
}
```

### 8.3 什么时候用 sync.Map

| 场景 | 推荐 |
|------|------|
| 读多写少（如缓存） | sync.Map |
| 写多读少 | 普通 map + `sync.Mutex` / `sync.RWMutex` |
| 读写均衡 | 普通 map + `sync.RWMutex` |
| 单协程使用 | 普通 map（最快） |

> **经验法则**：大多数情况下，`sync.Mutex` 保护普通 map 比 `sync.Map` 更通用。`sync.Map` 只在特定场景（键稳定、读多写少）下有性能优势。

---

## 九、常见用法

### 9.1 用 map 做 set

Go 没有内置 set 类型，用 map 的 key 来模拟：

```go
// set 基本操作
set := map[string]struct{}{} // struct{} 不占内存，是惯用写法

// 添加
set["apple"] = struct{}{}
set["banana"] = struct{}{}

// 查找
if _, ok := set["apple"]; ok {
    fmt.Println("apple 在集合中")
}

// 删除
delete(set, "banana")

// 大小
fmt.Println(len(set)) // 1

// 遍历
for item := range set {
    fmt.Println(item)
}
```

### 9.2 用 map 做计数器

```go
// 统计字符出现次数
func countChars(s string) map[rune]int {
    counter := make(map[rune]int)
    for _, ch := range s {
        counter[ch]++ // 不存在时自动初始化为 0 再 +1
    }
    return counter
}

// Go 的 map 零值特性让计数器写法极其简洁
// counter[ch]++ 等价于:
// C++ 中: counter[ch]++; (unordered_map 的 operator[] 也会自动插入 0)
```

### 9.3 map 作为函数参数（替代返回多个值）

```go
// 同时返回值和错误信息（简化示例）
func lookup(name string) (string, bool) {
    db := map[string]string{
        "Alice": "工程师",
        "Bob":   "设计师",
    }
    role, ok := db[name]
    return role, ok
}
```

---

## 十、常见坑

### 坑 1：nil map 读不 panic，写会 panic

```go
var m map[string]int // nil map

_ = m["key"]  // OK，返回零值 0，不 panic
// m["key"] = 1 // panic: assignment to entry in nil map
```

**解决**：用 `make` 或字面量初始化，或在写入前检查 `m == nil`。

### 坑 2：未初始化的 map 不能直接写入

```go
var m map[string]int // 这是 nil，不是空 map！
m["a"] = 1          // panic

// 正确做法
m = make(map[string]int)
m["a"] = 1          // OK
```

### 坑 3：并发读写直接 fatal

```go
// Go map 的并发保护不是 data race 检测，而是运行时直接 crash
// 即使加了 -race 也不一定能提前发现

// 正确做法：sync.Map 或 Mutex
var mu sync.Mutex
var m = map[string]int{}

mu.Lock()
m["key"] = 1
mu.Unlock()
```

### 坑 4：for range 顺序随机

```go
// 不能假设遍历顺序，即使你按顺序插入
// 如果需要有序，先提取 key 到切片再排序
```

### 坑 5：map 不能比较（除了和 nil）

```go
m1 := map[string]int{"a": 1}
m2 := map[string]int{"a": 1}

// m1 == m2  // 编译错误：operator == not defined on map

// 只能和 nil 比较
if m1 == nil { ... } // OK
```

### 坑 6：struct 做 key 要注意可比较性

```go
type BadKey struct {
    Data []int // 切片字段！
}

// m := map[BadKey]string{} // 编译错误：invalid map key type BadKey
// 因为 BadKey 包含切片字段，整体不可比较

type GoodKey struct {
    X, Y int // 都是可比较的
}
// m := map[GoodKey]string{} // OK
```

---

## 十一、练习任务

- [ ] 用字面量创建一个 `map[string][]string`，存储 3 个爱好分组
- [ ] 编写一个函数，接收字符串切片，返回每个字符的出现次数（map[rune]int）
- [ ] 实现一个简单的「集合」类型：支持 Add、Contains、Remove、Size 方法
- [ ] 写一段代码演示 nil map 写入 panic，并用 `recover` 捕获
- [ ] 用 map 实现一个 LRU 缓存的简化版（只用 map + 列表）
- [ ] 对比 `sync.Map` 和 `sync.Mutex` + `map` 在读多写少场景下的性能差异（用 `go test -bench`）
- [ ] 编写一个函数，合并两个 map（重复 key 取后者值），返回新 map 不修改原 map

---

> 上一篇：[04-切片与数组](04-切片与数组.md) | 下一篇：[06-结构体与方法](06-结构体与方法.md)
