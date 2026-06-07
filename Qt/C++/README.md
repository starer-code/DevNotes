# C++ 学习笔记

## 目录

- [基础语法](#基础语法)
- [面向对象](#面向对象)
- [STL 容器](#stl-容器)
- [智能指针](#智能指针)
- [多线程](#多线程)

---

## 基础语法

### 变量与类型

```cpp
// 基本类型
int a = 10;
double b = 3.14;
char c = 'A';
bool d = true;
std::string str = "Hello";

// 自动类型推导
auto x = 10;        // int
auto y = 3.14;      // double
auto z = "Hello";   // const char*
```

### 引用与指针

```cpp
// 引用 - 必须初始化，不能为 null
int a = 10;
int &ref = a;  // ref 是 a 的引用

// 指针 - 可以为 null
int *ptr = &a;  // ptr 指向 a
*ptr = 20;      // 通过指针修改 a
```

---

## 面向对象

### 类与对象

```cpp
class Person {
private:
    std::string name;
    int age;
public:
    // 构造函数
    Person(const std::string &n, int a) : name(n), age(a) {}

    // 析构函数
    ~Person() {}

    // 成员函数
    void introduce() {
        std::cout << "我是 " << name << "，今年 " << age << " 岁" << std::endl;
    }
};
```

### 继承与多态

```cpp
// 基类
class Animal {
public:
    virtual void speak() = 0;  // 纯虚函数
    virtual ~Animal() {}
};

// 派生类
class Dog : public Animal {
public:
    void speak() override {
        std::cout << "汪汪！" << std::endl;
    }
};
```

---

## STL 容器

### 常用容器

```cpp
#include <vector>
#include <map>
#include <set>
#include <queue>

// vector - 动态数组
std::vector<int> vec = {1, 2, 3, 4, 5};
vec.push_back(6);
vec.pop_back();

// map - 键值对
std::map<std::string, int> mp;
mp["apple"] = 1;
mp["banana"] = 2;

// set - 有序集合
std::set<int> st = {3, 1, 4, 1, 5};
// st = {1, 3, 4, 5}

// queue - 队列
std::queue<int> q;
q.push(1);
q.pop();
```

---

## 智能指针

### unique_ptr

```cpp
#include <memory>

// 独占所有权
std::unique_ptr<int> ptr = std::make_unique<int>(42);
// ptr 离开作用域时自动释放
```

### shared_ptr

```cpp
// 共享所有权
std::shared_ptr<int> ptr1 = std::make_shared<int>(42);
std::shared_ptr<int> ptr2 = ptr1;  // 引用计数 +1
// 所有 shared_ptr 离开作用域时释放
```

---

## 多线程

### 基本使用

```cpp
#include <thread>
#include <mutex>

std::mutex mtx;

void printThread(int id) {
    std::lock_guard<std::mutex> lock(mtx);
    std::cout << "线程 " << id << " 执行中" << std::endl;
}

int main() {
    std::thread t1(printThread, 1);
    std::thread t2(printThread, 2);

    t1.join();
    t2.join();

    return 0;
}
```

---

## 常见问题

### Q: 什么时候用引用，什么时候用指针？

**A:**
- **引用**：函数参数传递，必须初始化，不能为 null
- **指针**：需要动态分配、可为 null、需要重新赋值

### Q: 智能指针的选择？

**A:**
- **unique_ptr**：独占所有权，性能最好
- **shared_ptr**：共享所有权，有引用计数开销
- **weak_ptr**：打破循环引用，配合 shared_ptr 使用
