# 06 - 反射（reflection）

> C++ 的 RTTI 只能拿到 `typeid`/`dynamic_cast` 少许信息；Go 的 `reflect` 能在运行时查看、遍历、修改任意类型与值

---

## 一、简述

**反射（reflection）**：程序在运行时检查自身的类型与结构，并据此做动态操作。Go 里就是 `reflect` 包：给你 `reflect.Type`（类型信息）和 `reflect.Value`（一段具体值），能动态读字段、读 tag、调方法、甚至**修改可设置的值**。序列化库（encoding/json）、ORM、配置解析、测试断言统统建立在这套 API 之上。但反射有显著的性能代价与脆弱性——本章教你怎么用、什么时候值得用。

> **核心要点**：反射的入口是 `reflect.TypeOf` / `reflect.ValueOf`，一切操作都围着这两个对象转；**可设置性（CanSet）** 是反射修值的前提（变量要可寻址）；**三大定律**是官方给的使用边界。对 C++ 来说，`typeid`/`dynamic_cast` 只能做"类型识别"，Go 反射还能"改值、建新值、动态调用"，范围大得多，代价也大得多。

---

## 二、C++ 对照速查表

| 概念 | C++ | Go | 关键差异 |
|------|-----|-----|----------|
| 类型识别 | `typeid(x).name()` | `reflect.TypeOf(x)` | C++ 只给名字，Go 给结构、字段、方法全图 |
| 运行时类型转换 | `dynamic_cast<T>`（须多态） | `reflect.Value` + `Type.AssertableTo` / 类型断言 | Go 反射不要求继承，直接看类型 |
| 遍历字段 | `boost::pfr`/手写 | `reflect.Value.NumField/Field` | Go 原生支持任意结构体遍历 |
| 读字段 tag | 无标准机制 | `reflect.StructTag.Get` | Go 的 struct tag 是反射的主要消费场景 |
| 动态改值 | `*T` + `reinterpret_cast` 危险操作 | `reflect.Value.Set*` | Go 有 `CanSet` 检查，越界即 panic |
| 动态调用方法 | `std::invoke`（C++17，仍要具体类型） | `reflect.Value.Method(i).Call(...)` | Go 无需编译期函数指针，纯运行时 |
| 创建新实例 | `T{}` 写死 / 工厂模式 | `reflect.New(T)` | 反射可"凭空造值"，C++ 做不到通用 |
| 性能 | 零开销（编译期类型） | 每次反射调用开销 ~几百 ns 起 | Go 反射充满动态分派与检查 |
| 应用场景 | typeid 用于调试/序列化 | 序列化/ORM/测试/DI | 反射生态在 Go 里是日常 |
| 类型断言 | C++ 无 | `x.(T)` 是内置语法 | 注意反射 `TypeOf` + 断言可以互相换算 |

---

## 三、逐主题详解

### 3.1 反射两大入口：Type 与 Value

```go
package main

import (
	"fmt"
	"reflect"
)

type Person struct {
	Name string `json:"name"`
	Age  int    `json:"age"`
}

func main() {
	p := Person{Name: "小甲", Age: 18}

	t := reflect.TypeOf(p) // 类型信息
	v := reflect.ValueOf(p) // 值信息

	fmt.Println("Type:", t)             // main.Person
	fmt.Println("Kind:", t.Kind())       // struct
	fmt.Println("Value:", v)             // {小甲 18}
	fmt.Println("TypeOf(v):", v.Type())  // main.Person
}
```

- **`reflect.Type`**：描述"类型是什么"——包名、名称、Kind、字段列表、方法集、是否可比较等。URI：`t.NumField()`、`t.Field(i)`、`t.Method(i)`。
- **`reflect.Value`**：描述"这段值是什么"——包含了底层值，可读可设（受 `CanSet` 约束）、可调方法、可转 interface。
- **`Kind()`**：底层类别（`Int`、`String`、`Slice`、`Struct`、`Map` 等 26 种）。`Type` 是具体类型（`main.Person`），`Kind` 是粗类别（`struct`）——C++ 里没有直接对应，最接近 `typeid` 得不到 Kind；Go 里 `Kind` 用于判断"数据结构形状"。

### 3.2 从 Value 取回具体值：`Interface()`

```go
v := reflect.ValueOf(p)
// 把 Value 还原成 interface{}
i := v.Interface()
// 再断言回具体类型
p2 := i.(Person)
fmt.Println(p2.Name) // 小甲
```

- 老代码里 `v.Interface()` + 类型断言是组合拳；Go 1.x 有 `v.CanInterface()` 检查（未导出字段、`flag` 受限时不可 Interface()）。
- 原则：**反射只是"绕到类型系统后面看一眼"，看完一定要回到具体类型继续干活**。

### 3.3 对 struct 字段遍历与 tag 读取（json 的底层原理）

```go
func dumpStruct(s any) {
	v := reflect.ValueOf(s)
	t := v.Type()

	fmt.Printf("类型: %s\n", t)
	for i := 0; i < v.NumField(); i++ {
		field := t.Field(i)        // reflect.StructField
		val := v.Field(i)          // reflect.Value
		tag := field.Tag.Get("json") // 读 tag

		fmt.Printf("  字段 %s  kind=%v 值=%v tag=%q\n",
			field.Name, field.Type.Kind(), val.Interface(), tag)
	}
}
```

```go
dumpStruct(Person{Name: "张三", Age: 22})
// 输出：
// 类型: main.Person
//   字段 Name kind=string 值=张三 tag="name"
//   字段 Age kind=int 值=22 tag="age"
```

- **这就是 `encoding/json` 的底层机制**：遍历 struct 字段 → 看 `json:"xxx"` tag 决定键名/跳过 → 按字段类型编码/解码。
- `StructTag.Get("json")` 可以返回 `name,omitempty` 这样的组合串（`Lookup` 可区分"有但空"和"没有"）。
- 字段可以是导出（大写）或未导出（小写）；未导出字段反射读值会 panic，写值 `CanSet=false`。

### 3.4 可设置性（CanSet）与修改值

反射改值前提：**值必须是可以寻址的（addressable）**。`reflect.ValueOf(p)` 拿到的是拷贝的 p——改它改不到原对象。

```go
func setAge(ptr any) {
	v := reflect.ValueOf(ptr)  // 传来的是 *Person
	v = v.Elem()               // 解引用到 Person，现在可寻址

	if v.Kind() != reflect.Struct {
		return
	}
	// 只为演示：拿到 Age 字段
	f := v.FieldByName("Age")
	if f.CanSet() {            // 关键检查
		f.SetInt(99)
	}
}

p := Person{Name: "李四", Age: 1}
setAge(&p)                    // 必须传指针！
fmt.Println(p.Age)            // 99
```

关键要点：
- **可寻址（addressable）**：来自 `&x`（指针解引用）或可寻址的 slice/map 元素；`ValueOf(p)` 直接传入的"值拷贝"**不可寻址**。
- `Elem()` 对 `*T` 相当于 `*ptr`；对 interface 相当于取值。
- `CanSet` 在两种情况下 false：值不可寻址、字段为未导出。
- `SetInt/SetString/SetBool...` 有类型检查，类型不匹配会 panic。

> **C++ 对照**：这像"把一个 `void*` 强制转成 `T*` 再写"，但 C++ 全靠程序员自觉（`reinterpret_cast` 无类型检查）；Go 的 `CanSet` 是**运行时硬检查**，写错就 panic，不会悄悄破坏内存。这也是"反射 = 安全的 reinterpret_cast + 类型检查"的形象比喻。

### 3.5 动态调用方法

```go
package main

import (
	"fmt"
	"reflect"
)

type Svc struct{}

func (Svc) Hello(name string) string {
	return "hello " + name
}

func callMethod(svc any, name string, args ...any) []any {
	v := reflect.ValueOf(svc)
	m := v.MethodByName(name) // 找方法
	if !m.IsValid() {
		return nil
	}
	argv := make([]reflect.Value, len(args))
	for i, a := range args {
		argv[i] = reflect.ValueOf(a)
	}
	out := m.Call(argv) // 动态调用！（m.Call 返回 []Value）
	res := make([]any, len(out))
	for i, r := range out {
		res[i] = r.Interface()
	}
	return res
}

func main() {
	svc := Svc{}
	r := callMethod(svc, "Hello", "Go反射")
	fmt.Println(r) // [hello Go反射]
}
```

- `MethodByName` + `Call` 是 Go 反射里最"魔法"的操作：**没有任何编译期的函数指针/方法表，纯运行时按名字调用**。
- `Call` 的参数是 `[]reflect.Value`，返回值也是 `[]reflect.Value`。
- 性能开销：每次都走完整个动态分派——比直接调用慢**一到两个数量级**。
- C++ 要做到类似"按名字调方法"，要么宏魔法、要么自己维护字符串→函数指针表；Go 天生就有。

### 3.6 反射的三大定律（官方语）

来自官方《The Laws of Reflection》：

1. **反射将 interface{} 变量转成反射对象**：`reflect.ValueOf(i)` / `reflect.TypeOf(i)`。

```go
var x float64 = 3.4
fmt.Println(reflect.TypeOf(x)) // float64
v := reflect.ValueOf(x)
fmt.Println(v.Type())          // float64
```

2. **反射对象可以还原为 interface{} 变量**：`v.Interface()`。

```go
y := v.Interface().(float64) // 圆整回路
fmt.Println(y)               // 3.4
```

3. **要修改反射对象，其值必须是可设置的（settable）**：`CanSet` 检查、传指针、`Elem()` 解引用。

```go
// ❌ 想改 v 本身（不可设置）
// v.SetFloat(7.1)   // panic: reflect: reflect.Value.SetFloat using unaddressable value

// ✅ 传指针走对路
pv := reflect.ValueOf(&x)
pv.Elem().SetFloat(7.1)
```

> ⚠️ 三大定律第一条的"注意"：`reflect.ValueOf(&x)` 得到的是 `*float64` 的 Value；要访问 `x` 本身必须 `Elem()`。

### 3.7 反射建新值：`New` / `MakeSlice` / `MakeMap`

反射不仅能读，还能"凭空造物"（工厂模式/依赖注入的工具）：

```go
// 创建一个指定类型的新指针
t := reflect.TypeOf(Person{})
p := reflect.New(t)          // *Person，零值
p.Elem().FieldByName("Name").SetString("动态创建")
fmt.Println(p.Interface().(*Person).Name) // 动态创建

// 造切片
slice := reflect.MakeSlice(reflect.SliceOf(reflect.TypeOf(0)), 0, 10)
// 造 map：tag 自动建桶
m := reflect.MakeMap(reflect.MapOf(reflect.TypeOf(""), reflect.TypeOf(0)))
m.SetMapIndex(reflect.ValueOf("a"), reflect.ValueOf(1))
```

- 这些是泛型编程/通用库（如深拷贝库、ORM 的建行）的基础原语。
- C++ 里"运行时按类型建对象"只有 `std::any`+手写工厂映射；Go 内置。

### 3.8 反射的性能代价：量级未必"很糟"，但绝不是免费

```go
// 基准三连：直接调用 / 类型断言 / 反射调用
func BenchmarkDirect(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = hello("x")
	}
}
func BenchmarkReflect(b *testing.B) {
	svc := reflect.ValueOf(Svc{})
	m := svc.MethodByName("Hello")
	argv := []reflect.Value{reflect.ValueOf("x")}
	for i := 0; i < b.N; i++ {
		_ = m.Call(argv)
	}
}
```

```bash
go test -bench=. -benchmem
# 典型量级（不加 cgo）：
# BenchmarkDirect    ~10 ns/op
# BenchmarkReflect   ~300-1000 ns/op   （30~100 倍差距）
```

- 每层反射调用都包含：接口装箱、类型检查、方法查找、参数/返回值包装，且**逃逸分析很难看懂反射路径**（大量堆分配，见 [[02-逃逸分析与内存分配]]）。
- 但不是"反射=没救"：**热路径避免、冷路径（启动加载、配置解析）随便用**。

### 3.9 什么时候值得用反射（决策清单）

| 场景 | 反射适合吗 | 说明 |
|------|-----------|------|
| 序列化/反序列化（json/yaml 等） | ✅ 必须 | 通用库只能反射结构体 |
| ORM（gorm 等）增改查 | ✅ 必须 | 建表/映射字段 |
| 测试断言框架（深对比、table-driven helper） | ⚠️ 部分 | 比手写强，但热测试慎用 |
| 配置解析、Tag 驱动的约定式代码 | ✅ | 冷启动路径，随便用 |
| DI 容器 | ✅ | 造类型实例 |
| **高频业务代码里传来传去的通用操作** | ❌ 避免 | 用泛型（Go 1.18+）或接口改写 |
| 想"动态改结构体字段值"做业务改动 | ❌ 避免 | 多数可以用具名方法/字段改造 |

> **C++ 对照**：C++ 你会为"通用序列化"写模板（`template<class T> void serialize(T&)`），编译期全展开——**零反射需求、零运行时代价**。Go 没有模板展开这种机制（泛型也只是编译期轻约束），通用库妥协用反射。代价是运行期开销，换来的是一份运行时类型信息可被各种工具共享。**这是语言哲学差异：C++ 把"通用"放在编译期，Go 把"通用"放在运行期。**

### 3.10 泛型时代：反射与泛型的协作边界

Go 1.18+ 有了泛型，但**泛型替代不了反射**，两者分工不同：

| 能力 | 泛型（编译期） | 反射（运行期） |
|------|---------------|----------------|
| 依具体类型生成不同实现 | ✅ | ❌ |
| 运行时才知道类型名（读用户输入） | ❌ | ✅ |
| 遍历任意结构体字段/tag | ❌ | ✅ |
| 动态改任意字段 | ❌ | ✅ |
| 建"运行时指定的类型"的新实例 | ❌ | ✅ |
| 热路径的性能 | ✅（可达没开销） | ❌（几百 ns 起） |

**实用模式：泛型做"类型安全的外壳"，反射做"通用内心"**：

```go
// 外壳：调用者拿到的类型安全 API
func ToJSON[T any](v T) (string, error) {
	// 内部需要反射兜底（json 本身就用反射）
	return marshalReflect(v)
}
```

- 核心结论：**凡你能在编译期描述"对哪些类型做同样的事"，用泛型；凡类型到运行期才知道（反序列化、配置注入、动态扩展），用反射。**
- 所以你写的库，优先给用户"泛型接口 + 反射内部实现"的双层设计——公开 API 干净，内部功能完整。

### 3.11 `reflect.Value` 的底层与"安全"：为什么它不是 `reinterpret_cast`

`reflect.Value` 内部持有：类型信息 + 数据指针（如果可寻址）或拷贝，并带一堆标志位。它**不是 C 指针**：

- 反射对每个操作都做类型检查（`SetInt` 到非 int 字段 = panic，而不是悄悄写坏内存）。
- 反射不会让你写出"越界读"（`Field(i)` 越界 panic）。
- 反射不会绕过 GC（Value 本身是普通对象，指向 GC 对象时参与引用计数与 Mark）。

> 因此：**当你觉得自己需要"越过类型系统干点危险的事"（如转换二进制布局），先用反射想想；反射不够（要看原始字节）才轮到 [[07-unsafe与cgo互操作]] 的 `unsafe.Pointer`。**
>
> 顺便一提：Go 的**类型断言** `x.(T)`（见 [[02-语言进阶/06-类型断言与type-switch]]）在底层也依赖运行时的动态类型数据，但它是**语法级的安全操作**，与 `reflect` API 无关——性能远好于反射，能表达"类型选择"时优先用它。

---

## 四、常见坑与误区

### 坑 1：`reflect.ValueOf(p)` 后想改 p——改了个寂寞

**现象**：`v := reflect.ValueOf(p); v.FieldByName("Age").SetInt(99)` panic 或无效。
**原因**：`ValueOf(p)` 是 p 的**拷贝**，不可寻址；`CanSet()==false`。
**正确写法**：传 `&p`，`v.Elem()` 后 `FieldByName(...).SetInt(99)`。

### 坑 2：对未导出字段反射——读 panic、写 panic

**现象**：遍历一个含小写字段的 struct 时 `v.Interface()` 或 `SetXxx` panic。
**原因**：反射对未导出字段的访问被语言规则拒绝（`CanInterface()==false`、`CanSet()==false`）。
**正确写法**：反射处理前判断 `CanInterface()`/`CanSet()`；或让所有要反射的字段导出。

### 坑 3：把 `placeholder zero Value` 当真值用

**现象**：`MethodByName("不存在的")` 返回个"零值 Value"，直接 `.Call` panic。
**原因**：找不到时返回的是无效的 `reflect.Value`，`IsValid()==false`。
**正确写法**：所有"按名找"的结果先 `if !m.IsValid() { return }`；`FieldByName`、`MapIndex`、`Interface` 同理。

### 坑 4：从 C++ 带来的"typeid 就是名字"——忽略 Kind 与字段

**现象**：`reflect.TypeOf(p).Name()` 打出来 `Person` 就结束了，不会遍历字段/tag。
**原因**：把 Go 反射想窄了。`Type` 还背了字段、方法、tag、可比较性等一大堆信息。
**正确认知**：Go 反射定位是"完备的类型自省"，与 C++ `typeid` 的"标识类型"完全不是一个量级。**能用它做的很多，等于给你一个不越界版本的 `reinterpret_cast` + `typeid` 全家桶。**

### 坑 5：拿反射跑热路径，然后困惑"怎么慢这么多"

**现象**：在每秒几十万次的循环里 `reflect.ValueOf(x).Kind()` 判断类型，性能崩了。
**原因**：反射每步都有动态分派、装箱、异常检查。
**正确写法**：热路径用类型断言（`switch x := v.(type)`）或泛型；把反射收敛到**冷启动/低频**路径。需要动态注册的中心用反射，具体处理函数回到具体类型。

### 坑 6：用反射"复制结构体"，没意识到指针 vs 值语义

**现象**：深拷贝库用反射时，拷贝结果里切片/映射与源还是共享底层。
**原因**：struct 的浅拷贝语义：slice/map/chan 字段复制的是"引用头"。
**正确认知**：反射不自动深拷贝；你需要自己递归处理 slice/map 字段（一些深拷贝库做了这件事）。C++ 里拷贝构造帮你全自动；Go 没有拷贝构造，反射要手动模拟。

### 坑 7：`reflect.SliceOf`/`MapOf` 组合类型时踩路由检查

**现象**：用 `reflect.SliceOf(reflect.TypeOf(...))` 拼复杂类型，结果 `Kind` 判断链条写错。
**原因**：嵌套类型（`[]map[string][]int`）每层都要 `Elem()` 走深，判断链容易漏层。
**正确写法**：解析这类组合类型时写递归 `parse(t reflect.Type)` 按 `Kind` 分支，逐层 `Elem()`。把 C++ 模板递归拆类型的思路搬过来，只是模板换成了 `reflect`。

### 坑 8：传 `nil` 给 `TypeOf`/`ValueOf`，以为能拿到"nil 的类型"

**现象**：`var v *MyStruct = nil; reflect.TypeOf(v)` 出来的是 `*main.MyStruct`（类型还在）；但 `var x any = nil; reflect.TypeOf(x)` 直接返回 `nil`。
**原因**：`TypeOf` 接收 `interface{}`，传「带类型的 nil 指针」时 interface 里有类型，反射能看到；传「裸 nil」时 interface 是空的，反射返回空 `Type`/`Value`（`IsValid()==false`）。
**正确写法**：任何反射函数入口先判 `if v.Kind() == reflect.Pointer && v.IsNil() { ... }`，对"数据可能为 nil"做显式处理——否则后续 `v.Elem()` 会 panic。

---

## 五、练习任务

- [ ] 写一个 `inspect` 函数，对任意 `struct` 打印：类型名、Kind、每个字段的名字/类型/tag/当前值
- [ ] 用反射遍历并读取一个含 `json` tag 的嵌套结构体，手动按 tag 生成一段 JSON 字符串（不借助 encoding/json）
- [ ] 写 `setAge(ptr any, age int)`：对任意含 `Age` 字段的 struct 设置年龄，验证指针 vs 值参数的区别
- [ ] 对照 C++ 的 `typeid`：分别用 `typeid(x).name()` 和 `reflect.TypeOf(x)` 打印自定义类型的全部可用信息，比较两者"真实信息量"的差距并总结
- [ ] 用 `MethodByName`+`Call` 动态调用一个带可变参数的方法，并在注释里写明它与 C++ `std::invoke` 的差异
- [ ] 用基准对比「类型断言实现的多态分发」与「反射 `Kind` 判断」在同一热循环里的 `ns/op`，验证"能断言就不反射"
- [ ] 写一个递归「深拷贝任意 struct」函数（处理 slice/map/指针/基本类型），思考它为什么快不起来
- [ ] 造一个包含 `omitempty`、`"-"`、嵌套 tag 的 struct，用反射手动模拟 `encoding/json` 的字段选取逻辑（跳过、改名、空值省略）
- [ ] 用 `reflect.New` 做一个极简 `FromEnv`：从环境变量按 `env:"KEY"` tag 注入字段值
- [ ] 验证「带类型的 nil 指针」vs「裸 nil」传给 `reflect.TypeOf`/`reflect.ValueOf` 的差异，并写出两种 nil 场景的正确防御代码
- [ ] 思考题：结合 Go 泛型（1.18+），哪些"以前必须用反射"的场景现在能改用泛型在编译期解决？举一例并说明为什么不能完全替代反射

---

## 六、延伸与参考

- [The Laws of Reflection（官方博客，必读）](https://go.dev/blog/laws-of-reflection) — 三大定律的原文出处
- [reflect 包文档](https://pkg.go.dev/reflect) — 全 API 参考（Type/Value/StructTag/Kind）
- [Go by Example: Reflection](https://gobyexample.com/reflection) — 交互式示例
- [encoding/json 源码](https://go.dev/src/encoding/json/) — 反射在真实库里的最好教材
- 相关笔记：[[02-语言进阶/01-接口interface]]、[[02-语言进阶/06-类型断言与type-switch]]、[[02-语言进阶/03-泛型generics]]、[[05-encoding-json与配置文件]]、[[07-unsafe与cgo互操作]]

> 总结一句话：**能编译期解决（类型断言、泛型）就不要反射；能反射解决（通用序列化/ORM/DI）就不要 unsafe。** 安全层级从高到低：类型断言 → 泛型 → 反射 → unsafe。