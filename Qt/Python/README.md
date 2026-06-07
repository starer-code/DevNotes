# Python 学习笔记

## 目录

- [基础语法](#基础语法)
- [数据结构](#数据结构)
- [面向对象](#面向对象)
- [文件操作](#文件操作)
- [PyQt6](#pyqt6)

---

## 基础语法

### 变量与类型

```python
# 基本类型
a = 10          # int
b = 3.14        # float
c = "Hello"     # str
d = True        # bool

# 列表
lst = [1, 2, 3, 4, 5]

# 字典
mp = {"apple": 1, "banana": 2}

# 集合
st = {1, 2, 3, 4, 5}
```

### 列表推导式

```python
# 生成 1-10 的平方
squares = [x**2 for x in range(1, 11)]

# 过滤偶数
evens = [x for x in range(20) if x % 2 == 0]
```

---

## 数据结构

### 常用操作

```python
# 列表
lst = [1, 2, 3]
lst.append(4)      # 添加
lst.pop()          # 弹出最后一个
lst.insert(0, 0)   # 在索引 0 处插入

# 字典
mp = {}
mp["key"] = "value"
mp.get("key", "default")

# 集合
st = set()
st.add(1)
st.remove(1)
```

---

## 面向对象

### 类与对象

```python
class Person:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    def introduce(self):
        print(f"我是 {self.name}，今年 {self.age} 岁")
```

### 继承

```python
class Student(Person):
    def __init__(self, name, age, grade):
        super().__init__(name, age)
        self.grade = grade

    def study(self):
        print(f"{self.name} 正在学习")
```

---

## 文件操作

### 读写文件

```python
# 写文件
with open("file.txt", "w") as f:
    f.write("Hello World")

# 读文件
with open("file.txt", "r") as f:
    content = f.read()
```

### JSON 操作

```python
import json

# 写入 JSON
data = {"name": "Alice", "age": 25}
with open("data.json", "w") as f:
    json.dump(data, f)

# 读取 JSON
with open("data.json", "r") as f:
    data = json.load(f)
```

---

## PyQt6

### 基本窗口

```python
from PyQt6.QtWidgets import QApplication, QMainWindow, QLabel
import sys

app = QApplication(sys.argv)
window = QMainWindow()
window.setWindowTitle("Hello PyQt6")
window.setGeometry(100, 100, 400, 300)
window.show()
sys.exit(app.exec())
```

### 信号槽

```python
from PyQt6.QtWidgets import QPushButton

def on_click():
    print("按钮被点击")

button = QPushButton("点击我", parent=window)
button.clicked.connect(on_click)
```

---

## 常见问题

### Q: Python 和 C++ 的主要区别？

**A:**
- **Python**：动态类型、解释执行、简单易学
- **C++**：静态类型、编译执行、性能高

### Q: 什么时候用 PyQt，什么时候用 PySide？

**A:**
- **PyQt6**：Riverbank Computing 开发，GPL/商业许可
- **PySide6**：Qt 官方开发，LGPL 许可（更宽松）
