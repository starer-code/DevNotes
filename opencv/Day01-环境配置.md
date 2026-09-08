# OpenCV Day01 - 环境配置

> 配置 OpenCV 4.10 开发环境 (Visual Studio)

## 配置步骤

### 1. 包含目录

项目属性 → VC++ 目录 → 包含目录，添加：

```
D:\opencv\build\include
```

### 2. 库目录

项目属性 → VC++ 目录 → 库目录，添加：

```
D:\opencv\build\x64\vc16\lib
```

> vc16 对应 Visual Studio 2019/2022

### 3. 链接器输入

项目属性 → 链接器 → 输入 → 附加依赖项，添加：

```
opencv_world4100.lib
```

### 4. 环境变量

系统环境变量 Path 中添加：

```
D:\opencv\build\x64\vc16\bin
```

## 验证

```cpp
#include <opencv2/opencv.hpp>
#include <iostream>

int main() {
    std::cout << "OpenCV Version: " << CV_VERSION << std::endl;
    return 0;
}
```

## 常见问题

- 运行时弹出找不到 dll → 检查环境变量是否配置正确
- 链接错误 → 检查库目录和附加依赖项
