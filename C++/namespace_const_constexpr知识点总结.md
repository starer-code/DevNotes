# namespace / const / constexpr 知识点总结

## 目录

- [1. namespace 命名空间](#1-namespace-命名空间)
- [2. const 常量限定符](#2-const-常量限定符)
- [3. constexpr 编译期常量](#3-constexpr-编译期常量)
- [4. const 与 constexpr 的区别](#4-const-与-constexpr-的区别)
- [5. 综合实战](#5-综合实战)
- [6. 总结](#6-总结)

---

## 1. namespace 命名空间

`namespace`（命名空间）用于**避免全局命名冲突**，把相关的类型、函数、变量组织在一起，形成逻辑上的"作用域边界"。

> **核心要点**：命名空间本质上是给标识符加了一个"姓氏"，从而把不同的名字区分开。

### 1.1 基本声明与使用

```cpp
#include <iostream>

namespace Math {
    const double PI = 3.141592653589793;

    int add(int a, int b) {
        return a + b;
    }
}

int main() {
    // 使用 "::" 作用域限定符访问命名空间中的成员
    std::cout << Math::PI << std::endl;        // 3.14159...
    std::cout << Math::add(3, 4) << std::endl; // 7
    return 0;
}
```

### 1.2 命名空间的特点

| 特点 | 说明 |
|------|------|
| 可嵌套 | 命名空间内部可以再定义命名空间 |
| 可累加 | 同一作用域下多次声明同一命名空间会合并 |
| 可匿名 | 匿名命名空间相当于"文件内 static"，仅本文件可见 |
| 可起别名 | `namespace M = Math;` 简化访问 |

### 1.3 嵌套命名空间

```cpp
namespace Outer {
    namespace Inner {
        void foo() { /* ... */ }
    }
}

// C++17 起可以简写为：
namespace Outer::Inner {
    void bar() { /* ... */ }
}

// 访问方式
Outer::Inner::foo();
Outer::Inner::bar();
```

### 1.4 匿名命名空间

匿名命名空间中的成员只在**当前翻译单元**（.cpp 文件）内可见，等价于 `static` 全局变量/函数，用于隔离实现细节。

```cpp
namespace {
    int fileLocal = 42;          // 等价于 static int fileLocal = 42;
    void helper() { /* 仅本文件可见 */ }
}
```

### 1.5 using 声明与 using 指令

| 形式 | 语法 | 作用范围 | 注意 |
|------|------|----------|------|
| using 声明 | `using std::cout;` | 只引入**一个**名字 | 推荐，冲突可控 |
| using 指令 | `using namespace std;` | 引入该命名空间的**所有**名字 | 易冲突，慎用 |

```cpp
#include <iostream>

// using 声明：只引入 cout
using std::cout;

int main() {
    cout << "hello" << std::endl;   // 无需 std:: 前缀
    return 0;
}
```

> **重要**：在头文件中**禁止**使用 `using namespace std;`，会污染所有包含该头文件的代码。

### 1.6 命名空间别名

```cpp
namespace VeryLongNamespaceName { /* ... */ }
namespace VL = VeryLongNamespaceName;  // 别名

VL::someFunction();
```

### 1.7 实参依赖查找（ADL）

当调用函数时，编译器除了在当前作用域查找，还会在**实参类型所在的命名空间**中查找。

```cpp
namespace MyLib {
    struct Point { int x; int y; };
    void print(const Point& p);  // 不用写 MyLib::print 也能找到
}

int main() {
    MyLib::Point p{1, 2};
    print(p);   // ADL：在 MyLib 命名空间中找到了 print
    return 0;
}
```

---

## 2. const 常量限定符

`const` 表示"**该对象在初始化后不能被修改**"。它既可以修饰变量，也可以修饰指针、引用、成员函数、参数等。

> **核心要点**：`const` 是"运行时 + 编译期"的常量——编译期强制只读检查，但值本身在运行时才确定也可以。

### 2.1 const 变量

```cpp
const int MAX = 100;       // 不可修改
// MAX = 200;              // 错误：不能修改 const 变量

int n = 42;
const int CN = n;          // 允许：用运行时值初始化 const
```

### 2.2 const 与指针

这是最容易混淆的地方，关键在于 **const 修饰的是指针本身还是指针指向的对象**。

| 写法 | 含义 |
|------|------|
| `const int *p;` | 指向常量的指针（可以改 p，不能改 *p） |
| `int const *p;` | 同上，等价写法 |
| `int *const p;` | 常量指针（不能改 p，可以改 *p） |
| `const int *const p;` | 两者都不可改 |

```cpp
int a = 1, b = 2;

const int *p1 = &a;   // p1 可以指向 b，但不能通过 p1 修改 a
p1 = &b;              // OK
// *p1 = 10;          // 错误

int *const p2 = &a;   // p2 必须指向 a，不能再改指向
*p2 = 10;             // OK，a 变为 10
// p2 = &b;           // 错误
```

### 2.3 const 引用

```cpp
int x = 5;
const int &r = x;      // 常引用：可以通过 r 读，但不能通过 r 写
// r = 10;             // 错误

// 常引用的最大价值：安全传递大型对象而不拷贝
void process(const std::string &s);  // 只读访问，避免拷贝开销
```

### 2.4 const 成员函数

`const` 成员函数保证**不修改对象内部状态**（非 mutable 成员）。

```cpp
class Counter {
public:
    Counter() : count_(0) {}

    int get() const {        // const 成员函数
        // count_ = 1;       // 错误：不能修改成员
        return count_;
    }

    void inc() {             // 非 const 成员函数
        ++count_;
    }

private:
    mutable int cache_ = 0;  // mutable 成员即使在 const 函数中也可修改
    int count_ = 0;
};
```

> **重要**：对象分 const 对象与非 const 对象。const 对象**只能调用 const 成员函数**。

```cpp
const Counter c;
c.get();   // OK
// c.inc(); // 错误：const 对象不能调用非 const 成员函数
```

### 2.5 const 修饰参数与返回值

```cpp
void foo(const std::string &s);   // 常引用参数：只读，不拷贝

// const 返回值：防止返回的引用被外部修改
const std::string& getRef();      // 返回 const 引用
```

---

## 3. constexpr 编译期常量

`constexpr` 表示"**可以在编译期求值**"的常量，是 C++11 引入、C++14/17/20 逐步增强的关键字。

> **核心要点**：`constexpr` 强调**编译期**求值，允许编译器在编译时就计算出结果，从而提升性能并可以做编译期检查。

### 3.1 constexpr 变量

```cpp
constexpr int SIZE = 100;        // 编译期常量，必须用常量表达式初始化
constexpr double PI2 = 3.14159;  // OK

int n = 10;
// constexpr int bad = n;        // 错误：n 不是常量表达式
```

`constexpr` 变量天生具备 `const` 属性，并且要求**编译期就能确定值**。

### 3.2 constexpr 函数

`constexpr` 函数既可以用于编译期，也可以在运行时调用。

```cpp
constexpr int square(int x) {
    return x * x;
}

constexpr int val = square(5);       // 编译期求值：val == 25

int n = 3;
int runtimeVal = square(n);          // 运行时也可以调用
```

C++14 起 constexpr 函数体内允许更多语句（局部变量、循环、if 等）。

```cpp
// C++14 起合法
constexpr int factorial(int n) {
    int result = 1;
    for (int i = 2; i <= n; ++i) {
        result *= i;
    }
    return result;
}
```

### 3.3 if constexpr（C++17）

`if constexpr` 在**编译期**根据常量条件选择代码分支，另一个分支不会被编译（可用于模板编程中消除"死代码"）。

```cpp
#include <iostream>
#include <type_traits>

template <typename T>
void printInfo(const T& v) {
    if constexpr (std::is_integral_v<T>) {
        std::cout << "整数: " << v << std::endl;
    } else if constexpr (std::is_floating_point_v<T>) {
        std::cout << "浮点: " << v << std::endl;
    } else {
        std::cout << "其他类型" << std::endl;
    }
}

printInfo(42);      // 整数
printInfo(3.14);    // 浮点
printInfo("hi");    // 其他类型
```

### 3.4 consteval 与 constinit（C++20）

| 关键字 | 作用 |
|--------|------|
| `consteval` | 强制编译期求值，否则编译错误 |
| `constinit` | 强制静态/线程局部变量的初始化发生在编译期（不保证 const） |

```cpp
consteval int cube(int x) {
    return x * x * x;
}
constexpr int v = cube(3);   // OK：编译期调用
// int v2 = cube(runtimeVal); // 错误：consteval 不允许运行时调用

constinit int g_value = 42;  // 静态存储期，编译期初始化
```

---

## 4. const 与 constexpr 的区别

| 对比项 | `const` | `constexpr` |
|--------|---------|-------------|
| 引入版本 | C/C++ 一直有 | C++11 |
| 本质 | 只读限定（运行期/编译期均可） | 编译期常量 |
| 初始化要求 | 可以是运行时值 | 必须是常量表达式 |
| 是否可做数组大小 | C++ 中不行（除非常量） | 可以 |
| 函数 | const 成员函数表示不改对象 | 可在编译期求值 |
| 修饰对象 | 变量、指针、引用、成员函数、参数 | 变量、函数、if 分支（if constexpr） |

```cpp
int getValue() { return 10; }

const int a = getValue();        // OK：运行时只读
// constexpr int b = getValue(); // 错误：getValue 不是 constexpr

constexpr int c = 10;            // 编译期常量
const int d = 10;                // 也是编译期可用
int arr[c];                      // OK（c 是常量表达式）
int arr2[d];                     // C++ 中 d 若为 const int = 10 也可用
```

> **经验法则**：能 `constexpr` 就 `constexpr`；只要求"不可修改"但值是运行时得到的，用 `const`。

---

## 5. 综合实战

### 5.1 命名空间 + constexpr 常量 + const 成员函数

```cpp
#include <iostream>

namespace Geometry {
    constexpr double PI = 3.141592653589793;

    class Circle {
    public:
        constexpr Circle(double r) : radius_(r) {}

        constexpr double area() const {
            return PI * radius_ * radius_;
        }

    private:
        double radius_;
    };
}

int main() {
    constexpr Geometry::Circle c(2.0);
    constexpr double area = c.area();   // 编译期计算面积
    std::cout << area << std::endl;     // 12.5663...
    return 0;
}
```

### 5.2 用 constexpr 定义编译期查找表

```cpp
constexpr int tableSize = 10;

constexpr int makeTable(int index) {
    return index * index;
}

int main() {
    static_assert(makeTable(5) == 25);   // 编译期断言
    return 0;
}
```

### 5.3 常见陷阱

| 陷阱 | 说明 |
|------|------|
| `const int *p` 读法 | 从右往左读：p 是指向 `const int` 的指针 |
| const 对象调非 const 函数 | 编译错误，需把成员函数声明为 const |
| `constexpr` 函数体里用运行时变量 | 该调用退化为运行时求值（C++11 中甚至不允许） |
| 头文件里 `using namespace std` | 污染全局命名空间，禁止 |

---

## 6. 总结

- **namespace**：组织代码、避免命名冲突的工具；配合 `using` 声明、别名、匿名空间、ADL 使用；头文件中禁止 `using namespace std`。
- **const**：只读限定符，贯穿变量、指针、引用、成员函数；核心难点是 `const` 修饰指针还是指针所指对象。
- **constexpr**：编译期常量/编译期求值函数；`if constexpr` 实现编译期分支裁剪；C++20 新增 `consteval` 强制编译期、`constinit` 保证编译期初始化。
- **三者配合**：用 namespace 组织、const 保证只读、constexpr 把能确定的计算提前到编译期，是写出清晰高效 C++ 代码的基础能力。

---
