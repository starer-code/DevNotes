# Qt 6 学习笔记

## 目录

- [Qt 6 新特性](#qt-6-新特性)
- [模块变化](#模块变化)
- [迁移指南](#迁移指南)

---

## Qt 6 新特性

### 核心改进

- **C++17 最低要求**
- **更好的性能**：移除了大量弃用 API
- **新的构建系统**：CMake 取代 qmake
- **图形管线**：支持 RHI（渲染硬件接口）

### 常用新 API

```cpp
// Qt 6 中的字符串处理
QString str = "Hello World";
str.contains("Hello", Qt::CaseInsensitive);  // true
str.split(" ", Qt::SkipEmptyParts);

// Qt 6 中的容器
QList<int> list = {1, 2, 3};
QMap<QString, int> map = {{"a", 1}, {"b", 2}};
```

---

## 模块变化

### 移除的模块

- QtMultimedia（需要重新集成）
- QtQuick 的某些旧模块

### 新增模块

- QtQuick3D：3D 渲染
- QtOpenGL：OpenGL 支持

---

## 迁移指南

### 从 Qt 5 迁移到 Qt 6

1. **更新 CMakeLists.txt**
   ```cmake
   # Qt 5
   find_package(Qt5 REQUIRED COMPONENTS Widgets)

   # Qt 6
   find_package(Qt6 REQUIRED COMPONENTS Widgets)
   ```

2. **替换弃用的 API**
   ```cpp
   // Qt 5
   QRegExp regex("pattern");

   // Qt 6
   QRegularExpression regex("pattern");
   ```

3. **更新信号槽连接**
   ```cpp
   // Qt 5（旧语法）
   connect(sender, SIGNAL(signal()), receiver, SLOT(slot()));

   // Qt 6（新语法）
   connect(sender, &Sender::signal, receiver, &Receiver::slot);
   ```
