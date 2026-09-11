# C++ 基础遗漏知识点

> 补充一些容易被忽略但重要的 C++ 基础知识。

---

## 1. bool 类型与 boolalpha

### 核心规则

| 场景 | 结果 | 说明 |
|------|------|------|
| `bool b = true` | 输出 `1` | 默认输出数字 |
| `bool b = false` | 输出 `0` | 默认输出数字 |
| `bool b = -8` | 输出 `1` | **非零即为 true** |
| `bool b = 0` | 输出 `0` | 零即为 false |

### boolalpha 操纵符

使用 `std::boolalpha` 可以让 `cout` 输出 `true/false` 而不是 `1/0`。

```cpp
#include <iostream>
using namespace std;

int main() {
    bool isTrue = true;
    
    // 默认输出（数字）
    cout << "默认: " << isTrue << endl;      // 输出: 1
    
    // 使用 boolalpha（文字）
    cout << boolalpha;
    cout << "boolalpha: " << isTrue << endl; // 输出: true
    
    // 非零值也为 true
    bool b = -8;
    cout << "-8 转 bool: " << b << endl;     // 输出: true
    
    return 0;
}
```

### 常见陷阱

```cpp
// 陷阱1：非零即为 true
bool b1 = 42;      // true
bool b2 = -1;      // true
bool b3 = 0.001;   // true
bool b4 = nullptr;  // false (C++11)

// 陷阱2：bool 与整数混合运算
int a = true + true;  // a = 2（true 被提升为 1）
int b = true * 10;    // b = 10
```

---

## 2. sizeof 运算符

### 基本用法

```cpp
#include <iostream>
using namespace std;

int main() {
    cout << "char:      " << sizeof(char) << endl;      // 1
    cout << "short:     " << sizeof(short) << endl;     // 2
    cout << "int:       " << sizeof(int) << endl;       // 4
    cout << "long:      " << sizeof(long) << endl;      // 4 或 8
    cout << "long long: " << sizeof(long long) << endl; // 8
    cout << "float:     " << sizeof(float) << endl;     // 4
    cout << "double:    " << sizeof(double) << endl;    // 8
    
    // 数组
    int arr[10];
    cout << "int[10]:   " << sizeof(arr) << endl;       // 40
    
    // 指针
    int* p;
    cout << "int*:      " << sizeof(p) << endl;         // 4 或 8
    
    return 0;
}
```

### 动态数组的 sizeof 陷阱

```cpp
int* arr = new int[10];
cout << sizeof(arr) << endl;  // 输出 4 或 8（指针大小，不是数组大小！）

// 正确获取动态数组大小：需要额外传参或用 vector
```

---

## 3. auto 关键字 (C++11)

### 基本用法

```cpp
auto x = 42;           // int
auto y = 3.14;         // double
auto z = "hello";      // const char*
auto flag = true;      // bool

// 推荐用于复杂类型
#include <vector>
#include <map>

std::vector<int> v = {1, 2, 3};
auto it = v.begin();   // std::vector<int>::iterator

std::map<std::string, int> m;
auto pair = std::make_pair("key", 1);
```

### 注意事项

```cpp
// auto 会忽略顶层 const
const int a = 10;
auto b = a;      // b 是 int，不是 const int
const auto c = a; // c 是 const int

// auto 保留底层 const
const int& ref = a;
auto ref2 = ref;  // ref2 是 const int&
```

---

## 4. nullptr (C++11)

### 与 NULL 的区别

```cpp
// NULL 在 C++ 中可能是 0 或 (void*)0
void func(int);
void func(char*);

func(NULL);    // 编译错误！歧义
func(nullptr); // OK，调用 func(char*)
```

### 最佳实践

```cpp
// 初始化指针
int* p = nullptr;

// 判断指针
if (p != nullptr) {
    // 使用 p
}

// 函数参数
void foo(int* ptr) {
    if (ptr == nullptr) {
        return;
    }
}
```

---

## 5. const 与 constexpr

### const vs constexpr

| 特性 | const | constexpr |
|------|-------|-----------|
| 初始化时机 | 运行时 | 编译时 |
| 可用于函数返回值 | 是 | 是 |
| 编译期常量 | 否 | 是 |
| constexpr 变量 | 必须 | 必须 |

```cpp
const int x = 10;        // OK
constexpr int y = 20;    // OK，编译期常量

// constexpr 函数
constexpr int square(int n) {
    return n * n;
}
constexpr int val = square(5);  // 编译期计算
```

---

## 6. static 关键字

### 静态局部变量

```cpp
void counter() {
    static int count = 0;  // 只初始化一次
    count++;
    cout << "调用次数: " << count << endl;
}

// 多次调用
counter(); // 调用次数: 1
counter(); // 调用次数: 2
counter(); // 调用次数: 3
```

### 静态全局变量/函数

```cpp
// file1.cpp
static int secret = 42;  // 只在本文件可见

// file2.cpp
// 无法访问 secret
```

---

## 总结

| 知识点 | 关键记忆 |
|--------|----------|
| bool | 非零即 true，用 `boolalpha` 输出文字 |
| sizeof | 指针大小 ≠ 数组大小 |
| auto | 自动推导类型，保留底层 const |
| nullptr | 类型安全的空指针，替代 NULL |
| constexpr | 编译期常量，用于优化 |
| static | 静态变量生命周期 = 程序生命周期 |

---

**验收清单**：
- [ ] 理解 bool 的隐式转换规则
- [ ] 能正确使用 boolalpha
- [ ] 理解 sizeof 对指针和数组的区别
- [ ] 能正确使用 auto 和 nullptr
- [ ] 区分 const 和 constexpr 的使用场景
