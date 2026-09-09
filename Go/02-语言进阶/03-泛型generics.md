# 03 - 泛型 generics

> 从 C++ 的 template 到 Go 1.18+ 的类型参数：更克制的泛型设计

---

## 一、简述

Go 1.18 正式引入泛型（类型参数 Type Parameters）。与 C++ 模板相比，Go 泛型**刻意保持简单**：没有特化、偏特化、模板元编程、运算符重载，只有"类型参数 + 约束（constraint）"两个核心概念。

> **核心要点**：Go 泛型的定位是**解决"写一遍、多个类型用"的容器与工具函数问题**，不是用来做编译期计算的。能用接口解决的场景，优先接口；泛型是接口的补充而非替代。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 声明 | `template <typename T>` | `func F[T any](...)` | Go 用 `[T]` 方括号 |
| 类型约束 | `std::is_integral_v<T>` / requires | `T int \| float64` 或 `constraints.Ordered` | Go 用类型集（union） |
| 特化 | `template<> struct X<int>` | ❌ 不支持 | Go 没有特化 |
| 偏特化 | `template <typename T> struct X<T*>` | ❌ 不支持 | Go 没有偏特化 |
| 默认参数 | `template <typename T = int>` | ❌ 不支持 | 无默认类型参数 |
| 泛型类 | `std::vector<T>` | `type Vec[T any] []T` | 泛型类型 |
| 泛型函数 | `T max(T a, T b)` | `func Max[T constraints.Ordered](a, b T) T` | 语法不同 |
| 编译期计算 | 模板元编程 / constexpr | ❌ 无 | Go 泛型是运行时类型，非代码生成 |
| 运算符重载 | 可对类型重载 | ❌ 不支持 | 泛型内不能直接用 `+` 除非约束允许 |

---

## 三、泛型函数

### 3.1 基本语法

```go
// [T any] 声明类型参数；T 在参数和返回值中可用
func Min[T any](a, b T) T {
    // ❌ 编译错误：any 没有约束，不能比较大小
    // if a < b { return a }
    return b
}
```

**问题**：`any` 意味着"任意类型"，编译器不知道 `T` 是否支持 `<`。必须用**约束**声明"T 是支持比较的有序类型"：

```go
import "cmp"  // Go 1.21+

// cmp.Ordered 约束：支持 < <= > >= 的类型（整数、浮点、字符串）
func Min[T cmp.Ordered](a, b T) T {
    if a < b {
        return a
    }
    return b
}

func main() {
    fmt.Println(Min(3, 5))       // 3（int）
    fmt.Println(Min(2.5, 1.8))   // 1.8（float64）
    fmt.Println(Min("abc", "abd")) // "abc"（string）
}
```

> **对照 C++**：`cmp.Ordered` ≈ `std::totally_ordered` concept（C++20 requires）。

### 3.2 类型参数与调用

```go
// 显式指定类型参数（一般可省略，编译器自动推断）
Min[int](3, 5)
Min[string]("a", "b")

// 推断调用
Min(3, 5)
```

---

## 四、约束（constraint）与类型集

### 4.1 类型集语法（union）

```go
// 用 | 声明"类型集"：T 只能是 int 或 float64
type Number interface {
    int | int64 | float64
}

func Sum[T Number](nums []T) T {
    var total T
    for _, n := range nums {
        total += n  // 现在 + 合法，因为类型集内的类型都支持 +
    }
    return total
}

func main() {
    fmt.Println(Sum([]int{1, 2, 3}))          // 6
    fmt.Println(Sum([]float64{1.5, 2.5}))     // 4
    // fmt.Println(Sum([]string{"a","b"}))    // ❌ string 不在类型集中
}
```

### 4.2 类型集 + 方法集（复合约束）

```go
// 约束可以同时有类型集和方法要求
type Stringer interface {
    ~string          // 底层类型是 string（含自定义类型）
    String() string  // 必须有 String 方法
}
```

> `~string` 表示"底层类型为 string 的所有类型"（含 `type MyStr string`），`string` 则只匹配字面类型。

### 4.3 标准库 constraints 包（Go 1.21 前用 golang.org/x/exp/constraints）

```go
import "golang.org/x/exp/constraints"

// constraints 提供常用约束
type Ordered interface {
    Integer | Float | ~string
}
// Integer = Signed | Unsigned（int, int8..., uint, uint8...）
// Float = float32 | float64
```

> Go 1.21+ 官方建议直接用标准库 `cmp.Ordered`（`cmp` 包，配合 `cmp.Compare` 使用）。

---

## 五、泛型类型

```go
// 泛型结构体：类似 std::pair
type Pair[K comparable, V any] struct {
    Key   K
    Value V
}

func main() {
    p := Pair[string, int]{Key: "age", Value: 30}
    fmt.Println(p.Key, p.Value)

    // 泛型切片
    type Vec[T any] []T
    v := Vec[int]{1, 2, 3}
    fmt.Println(v)
}

// 泛型方法 ❌ 不支持：方法不能有额外的类型参数
// func (p Pair[K, V]) Get[T any]() T { ... }  // 编译错误
```

> **重要限制**：**Go 方法不能定义自己的类型参数**（不能有"泛型方法"）。只有函数和类型可以有类型参数。这是与 C++ 模板成员函数最大的区别之一。

### 泛型容器示例：泛型栈

```go
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(item T) {
    s.items = append(s.items, item)
}

func (s *Stack[T]) Pop() (T, bool) {
    if len(s.items) == 0 {
        var zero T  // 声明 T 的零值
        return zero, false
    }
    item := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return item, true
}

func main() {
    stack := Stack[int]{}
    stack.Push(10)
    stack.Push(20)
    v, ok := stack.Pop()
    fmt.Println(v, ok)  // 20 true
}
```

---

## 六、泛型 vs 接口：怎么选

| 场景 | 推荐 | 原因 |
|------|------|------|
| 容器类（栈、队列、map 包装） | **泛型** | 类型安全，无需断言 |
| 工具函数（Max、Sum、去重） | **泛型** | 逻辑与类型无关 |
| 多态行为（不同实现有不同方法） | **接口** | 运行时多态 |
| 需要存储异构数据 | **接口 / any** | 泛型要求类型统一 |
| 方法需要自己的类型参数 | ❌ 只能用接口 | Go 方法不能泛型 |

```go
// 泛型适合：数据结构的类型无关操作
func Filter[T any](items []T, keep func(T) bool) []T {
    result := make([]T, 0)
    for _, item := range items {
        if keep(item) {
            result = append(result, item)
        }
    }
    return result
}

// 接口适合：行为的多态
// type Sorter interface { Less(i, j int) bool }  // sort.Interface 风格
```

---

## 七、综合实战：泛型 + 接口组合（Repository 模式）

把泛型（类型无关的数据结构）与接口（行为抽象）结合，是 Go 工程里的经典组合：**泛型负责"存什么"，接口负责"怎么存"**。

```go
// 1. 实体：任意类型
type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

// 2. 存储接口：行为抽象（可替换实现：内存版 / SQL 版 / Redis 版）
type Repository[T any] interface {
    FindByID(id int) (T, bool)
    Save(entity T) error
    All() []T
}

// 3. 泛型实现：内存版（类型无关，任何实体都能用）
type MemoryRepo[T any] struct {
    items map[int]T
    nextID int
}

func NewMemoryRepo[T any]() *MemoryRepo[T] {
    return &MemoryRepo[T]{items: make(map[int]T)}
}

func (r *MemoryRepo[T]) FindByID(id int) (T, bool) {
    item, ok := r.items[id]
    return item, ok
}

func (r *MemoryRepo[T]) Save(entity T) error {
    // 约定：实体必须实现 IDer 才能拿到 ID —— 但这里演示泛型 + 约束的边界
    r.items[r.nextID] = entity
    r.nextID++
    return nil
}

func (r *MemoryRepo[T]) All() []T {
    result := make([]T, 0, len(r.items))
    for _, item := range r.items {
        result = append(result, item)
    }
    return result
}

// 4. 业务层只面向接口编程：换存储实现不用改业务代码
func printAll[T any](repo Repository[T]) {
    for _, item := range repo.All() {
        fmt.Printf("%+v\n", item)
    }
}

func main() {
    var repo Repository[User] = NewMemoryRepo[User]()
    repo.Save(User{Name: "Tom"})
    repo.Save(User{Name: "Jerry"})
    printAll(repo)
    // {ID:0 Name:Tom}
    // {ID:1 Name:Jerry}

    // 同一个 Repository 接口，换一个实体类型照样用
    var intRepo Repository[int] = NewMemoryRepo[int]()
    intRepo.Save(100)
    printAll(intRepo)
}
```

> **要点**：`Repository[T any]` 是"泛型接口"——T 由使用方决定；`MemoryRepo[T]` 是泛型实现。**换存储实现**（如改成 `SQLRepo[T]`）时，业务代码零改动，这正是"依赖倒置 + 组合"的威力，也是 C++ 模板 + 抽象基类组合的 Go 版对照。

---

## 八、常见坑

### 坑 1：any 类型参数不能直接运算

```go
// ❌ 编译错误：any 没约束，不知道 T 支持 +
func Add[T any](a, b T) T { return a + b }

// ✅ 正确：用类型集声明支持 + 的类型
func Add[T int | float64](a, b T) T { return a + b }
```

### 坑 2：泛型不能做特化

```go
// C++ 可以：template<> std::string Max(std::string a, std::string b)
// Go ❌ 不支持为特定类型写不同实现
// 解决：用类型断言或类型开关在函数内部分支
func Describe[T any](v T) string {
    switch any(v).(type) {
    case int:
        return "整数"
    case string:
        return "字符串"
    default:
        return "未知"
    }
}
```

### 坑 3：comparable 约束

```go
// 泛型里想用 == 比较，必须约束为 comparable
func Contains[T comparable](items []T, target T) bool {
    for _, item := range items {
        if item == target {  // ✅ comparable 允许 ==
            return true
        }
    }
    return false
}

// comparable 包含可比较的类型（基本类型、指针、可比较的结构体/数组），
// slice/map/func 不可比较（== 会编译错误）
// 注意：comparable 类型都可以做 map 的 key（map[K]V 要求 K 可比较）
func main() {
    fmt.Println(Contains([]int{1, 2, 3}, 2))   // true
    fmt.Println(Contains([]string{"a", "b"}, "c")) // false
}
```

### 坑 4：实例化膨胀（类似 C++ 模板代码膨胀）

```go
// 每个不同的类型参数组合都会生成专用代码
Min(1, 2)       // int 版本
Min(1.5, 2.5)   // float64 版本
// Go 1.21+ 对相同内存形状（GC shape）的类型会共享实现，
// 但大量不同类型实例化仍会增加编译时间和二进制体积（与 C++ 模板膨胀同理）
```

### 坑 5：方法不能有独立类型参数

```go
type Box[T any] struct{ val T }

// ❌ 编译错误：方法不能定义类型参数
// func (b Box[T]) Map[U any](f func(T) U) Box[U] { ... }

// ✅ 解决：改成包级泛型函数
func Map[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{val: f(b.val)}
}
```

---

## 九、练习任务

- [ ] 用泛型实现 `Max` / `Min` / `Abs`（数值类型）三个函数，并用 int、float64 分别调用
- [ ] 用泛型实现 `Filter` 和 `Map`（类似 C++ STL 的 std::transform / remove_if）
- [ ] 实现泛型 `Stack[T any]`，包含 Push / Pop / Peek / Len 方法
- [ ] 用 `comparable` 实现 `Index[T comparable](items []T, target T) int`
- [ ] 实现一个泛型 `Sum[T Number]`，类型集包含 `int | int64 | float64`，验证自定义类型（`type MyInt int`）需要 `~int` 才能传入
- [ ] 对比：同一个"求集合差集"的功能分别用接口和泛型实现，说明各自优缺点

---

## 十、本节要点速查

| 概念 | 要点 |
|------|------|
| 泛型语法 | `func F[T any](...)` / `type Stack[T any] struct{...}`，方括号声明 |
| 约束 | `T int \| float64`（类型集）、`cmp.Ordered`（可比较）、`comparable`（可 ==） |
| `~` 符号 | `~string` = 底层类型是 string 的所有类型（含自定义类型） |
| 泛型类型 | 结构体/切片/map 都可泛型，实例化时指定类型参数 |
| 泛型方法 | ❌ **方法不能有自己的类型参数**，只能包级泛型函数 |
| 特化/偏特化 | ❌ 不支持（C++ 可以），需要分支时用类型断言 |
| 适用场景 | 容器、工具函数（Max/Sum/Filter）、Repository 等类型无关逻辑 |
| 与接口分工 | 泛型管"类型无关"，接口管"行为多态"；可组合使用 |
| 大坑 | `any` 不能运算、comparable 才能 ==、实例化膨胀 |

> 上一篇：[02-错误处理-error-panic-recover](02-错误处理-error-panic-recover.md) | 下一篇：[04-标准库核心包-fmt-strings-os-io-time](04-标准库核心包-fmt-strings-os-io-time.md)
