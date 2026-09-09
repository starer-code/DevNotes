# 01 - 接口 interface

> 从 C++ 的虚函数/抽象类到 Go 的接口：鸭子类型、隐式实现与组合式设计

---

## 一、简述

Go 的 `interface` 是一组**方法签名**的集合，它定义了类型"能做什么"，而不是"是什么"。与 C++ 的抽象类最大的不同：Go 接口是**隐式实现**——一个类型只要实现了接口里的所有方法，就自动满足该接口，**不需要显式声明** `implements`。

> **核心要点**：Go 接口让"面向接口编程"从设计原则变成了语言级强制。它催生了组合优于继承、依赖注入、mock 测试等一整套惯用法。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 抽象接口 | `class Shape { virtual double area() = 0; }` | `type Shape interface { Area() float64 }` | Go 只有方法签名，没有数据成员 |
| 实现 | `class Circle : public Shape { ... }` | `func (c Circle) Area() float64 { ... }` | **隐式实现**，无需继承声明 |
| 多态 | 虚函数表 vtable + 指针/引用 | 接口值（类型 + 数据指针） | 运行时动态分派，机制不同 |
| 空接口 | `void*` | `interface{}` / `any` | 表示任意类型，但不建议滥用 |
| 接口嵌套 | 多重继承（菱形问题） | 接口嵌入接口 | 无菱形问题 |
| 类型断言 | `dynamic_cast<T*>` | `v, ok := x.(T)` | Go 更安全：带 ok 判断 |
| 判断实现 | `typeid` / 编译期检查 | 编译期自动检查 | 只要方法对上即可 |

---

## 三、接口的定义与实现

### 3.1 定义接口

```go
// 定义接口：只声明方法，不实现
type Shape interface {
    Area() float64
    Perimeter() float64
}
```

### 3.2 隐式实现

```go
// Circle 不需要写 "implements Shape"，只要方法对上就自动满足
type Circle struct {
    Radius float64
}

func (c Circle) Area() float64 {
    return 3.14159 * c.Radius * c.Radius
}

func (c Circle) Perimeter() float64 {
    return 2 * 3.14159 * c.Radius
}

// Rectangle 同样自动实现 Shape
type Rectangle struct {
    Width, Height float64
}

func (r Rectangle) Area() float64 {
    return r.Width * r.Height
}

func (r Rectangle) Perimeter() float64 {
    return 2 * (r.Width + r.Height)
}
```

### 3.3 使用接口

```go
func printShape(s Shape) {
    fmt.Printf("面积=%.2f, 周长=%.2f\n", s.Area(), s.Perimeter())
}

func main() {
    c := Circle{Radius: 1.0}
    r := Rectangle{Width: 2, Height: 3}

    printShape(c) // 传入接口参数，自动多态
    printShape(r)

    // 接口变量可以存任意实现类型
    var s Shape = c
    fmt.Println(s.Area())
}
```

> **对照 C++**：C++ 必须 `class Circle : public Shape` 显式继承；Go 只要方法签名对上就行，**实现与接口完全解耦**——甚至可以给别人的类型补上方法让它满足你的接口。

---

## 四、接口值：类型 + 数据

接口变量底层是一个二元组 `(类型, 值)`，称为接口值。

```go
var s Shape = Circle{Radius: 2}
// 接口值内部: (Circle, Circle{Radius:2})
```

- 接口值为 `nil` 时，表示**类型和数据都是 nil**
- 一个接口变量持有 nil 指针时，接口本身**不是 nil**（经典坑，见第七节）

```go
var s Shape
fmt.Println(s == nil) // true，还没赋值

s = Circle{Radius: 1}
fmt.Println(s == nil) // false
```

---

## 五、空接口 `interface{}` 与 `any`

```go
// 空接口：没有任何方法，所有类型都实现它
var x interface{}
x = 42
x = "hello"
x = Circle{Radius: 1}

// Go 1.18+ 推荐用 any（等价别名）
var y any = 42
```

**空接口的用途**：
1. 函数参数接收任意类型（类似 C++ 的 `void*`）
2. 容器存异构数据（如 `[]interface{}`）

> ⚠️ **C++ 对照**：空接口 ≈ `void*`，但比 `void*` 安全——它带有类型信息，取出时必须类型断言。不过**不要滥用**，能用具体类型或泛型就优先。

---

## 六、接口嵌入与组合

Go 接口可以嵌入其他接口，形成"组合式"接口（替代 C++ 的多重继承）：

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

// 嵌入组合：新接口 = Reader + Writer
type ReadWriter interface {
    Reader
    Writer
}

// 等价写法（展开）
// type ReadWriter interface {
//     Read(p []byte) (n int, err error)
//     Write(p []byte) (n int, err error)
// }
```

**命名约定**：只含一个方法的接口，方法名 + `er` 后缀（`Reader`、`Writer`、`Closer`、`Stringer`）。

---

## 七、常见坑

### 坑 1：接口持有的 nil 指针 ≠ nil 接口

```go
type MyError struct{ Msg string }

func (e *MyError) Error() string { return e.Msg }

func doSomething() error {
    var err *MyError = nil   // 指针是 nil
    return err               // 返回时被包进接口，接口非 nil！
}

func main() {
    err := doSomething()
    if err != nil {          // ❌ 永远为 true！
        fmt.Println("有错误")  // 会走到这里
    }
}
```

> **原因**：接口值 `(类型, 值) = (*MyError, nil)`，类型非空 → 接口非 nil。
> **解决**：返回错误时，要么直接返回 `nil`，要么确保返回的指针变量本身就是 nil 接口：

```go
func doSomething() error {
    var err *MyError = nil
    if someCondition {
        err = &MyError{Msg: "出错了"}
    }
    if err == nil {   // 在函数内判断，返回真正的 nil
        return nil
    }
    return err
}
```

### 坑 2：值接收者 vs 指针接收者的方法集

```go
type Shape interface {
    Area() float64
}

type Circle struct{ Radius float64 }

// 用值接收者实现
func (c Circle) Area() float64 { return 3.14 * c.Radius * c.Radius }

func main() {
    var s Shape
    s = Circle{Radius: 1}  // ✅ 值类型可以
    s = &Circle{Radius: 1} // ✅ 指针也可以（指针自动有值方法集）

    // 如果方法是用指针接收者实现的：
    // func (c *Circle) Area() float64 { ... }
    // s = Circle{...}  // ❌ 编译错误！值类型没有指针方法集
}
```

> **规则**：方法集——值接收者的方法，值和指针都有；指针接收者的方法，只有指针有。存接口时要注意用哪种。

### 坑 3：大接口 = 坏设计

```go
// ❌ 反面：一个接口塞了 10 个方法
type Monster interface {
    Run() float64
    Jump() float64
    Swim() float64
    Fly() float64
    // ...
}

// ✅ 正面：接口要小而专注
type Runner interface { Run() float64 }
type Jumper interface { Jump() float64 }
```

> **Go 哲学**：接口**越小越好**（1~2 个方法）。调用方只声明自己需要的最小接口，实现方自然满足多个小接口。

### 坑 4：接口值比较可能 panic

```go
var a any = []int{1, 2, 3}
var b any = []int{1, 2, 3}
// fmt.Println(a == b)  // ❌ panic：slice 不可比较！
```

> 接口值比较时，底层类型必须是可比较的（基本类型、指针、可比较结构体）。slice/map/func 不可比较，会 panic。

---

## 八、练习任务

- [ ] 定义一个 `Speaker` 接口（含 `Speak() string`），让 `Dog` 和 `Cat` 两个结构体隐式实现它，并用一个函数打印所有动物的叫声
- [ ] 用值接收者和指针接收者各实现一遍，观察存接口时哪些可以赋值，并总结方法集规则
- [ ] 用接口嵌入组合出 `ReadWriteCloser`（Reader + Writer + Closer），并手写一个满足它的简单类型
- [ ] 写一个 `func PrintAll(items []any)`，接收混合类型切片，用 `fmt.Printf("%T\n", item)` 打印每个元素的类型
- [ ] 复现"坑 1"的 nil 指针问题，并改成正确写法
- [ ] 在标准库里找 3 个只含 1 个方法的接口（如 `io.Reader`、`fmt.Stringer`、`error`），说明各自的使用场景

---

## 九、本节要点速查

| 概念 | 要点 |
|------|------|
| 接口定义 | `type Shape interface { Area() float64 }`，只声明方法签名 |
| 隐式实现 | 方法签名对上即满足接口，**无需 `implements` 声明** |
| 接口值 | 二元组 `(类型, 数据)`；未赋值时接口本身为 `nil` |
| 空接口 | `interface{}` / `any`，所有类型都实现它，≈ C++ `void*` 但更安全 |
| 接口嵌入 | `type ReadWriter interface { Reader; Writer }`，组合替代多重继承 |
| 方法集规则 | 值接收者 → 值和指针都有；指针接收者 → 只有指针有 |
| 命名约定 | 单方法接口 = 方法名 + `er`（Reader / Writer / Stringer） |
| 大坑 | nil 指针塞进接口后 ≠ nil；slice/map 不能比较 |
| 设计哲学 | 接口**越小越好**，面向接口编程 + 依赖注入 |

> 上一篇：[03-流程控制-if-for-switch](../01-基础语法/03-流程控制-if-for-switch.md) | 下一篇：[02-错误处理-error-panic-recover](02-错误处理-error-panic-recover.md)
