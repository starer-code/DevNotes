# OpenCV 模板（VS2022 + CMake + Ninja）

> **基于你的环境变量：**
> - `OpenCV_DIR = <OpenCV安装目录>\build\x64\vc16\lib`
> - PATH 追加：`<OpenCV安装目录>\build\x64\vc16\bin`
>
> 遵循 `项目约定.md`：CMake 唯一构建系统、依赖走环境变量 + `find_package`、构建输出在 `out/build/`、不写死路径。

## 一、目录结构

```
<项目根目录>\OpenCVTemplate\
├── CMakeLists.txt
├── CMakePresets.json
├── .gitignore
├── src\
│   └── main.cpp
└── out\
    └── build\
```

## 二、CMakeLists.txt（复制到项目根目录）

```cmake
cmake_minimum_required(VERSION 3.20)
project(OpenCVTemplate LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------- OpenCV ----------
# OpenCV_DIR 由 CMakePresets.json 从环境变量注入，这里不写路径
find_package(OpenCV REQUIRED)

# ---------- 源文件 ----------
set(SOURCES
    src/main.cpp
)

add_executable(${PROJECT_NAME} ${SOURCES})

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    ${OpenCV_LIBS}
)
```

## 三、CMakePresets.json（复制到项目根目录）

```json
{
  "version": 3,
  "configurePresets": [
    {
      "name": "debug",
      "generator": "Ninja",
      "binaryDir": "${sourceDir}/out/build/${presetName}",
      "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Debug",
        "OpenCV_DIR": "$env{OpenCV_DIR}"
      }
    },
    {
      "name": "release",
      "inherits": "debug",
      "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Release"
      }
    }
  ],
  "buildPresets": [
    { "name": "debug", "configurePreset": "debug" },
    { "name": "release", "configurePreset": "release" }
  ]
}
```

## 四、.gitignore（复制到项目根目录）

```
.vs/
out/
CMakeUserPresets.json
*.user
*.suo
*.pdb
*.ilk
```

## 五、src/main.cpp（自检代码，可整段复制）

```cpp
#include <opencv2/opencv.hpp>
#include <iostream>

int main()
{
    std::cout << "OpenCV 版本: " << CV_VERSION << std::endl;

    // 生成一张 640x480 的渐变测试图并保存
    cv::Mat img(480, 640, CV_8UC3);
    for (int y = 0; y < img.rows; ++y)
        for (int x = 0; x < img.cols; ++x)
            img.at<cv::Vec3b>(y, x) = cv::Vec3b(
                static_cast<uchar>(x * 255 / img.cols),
                static_cast<uchar>(y * 255 / img.rows),
                128);

    const std::string out = "test_output.png";
    if (cv::imwrite(out, img))
        std::cout << "测试图已保存: " << out << std::endl;
    else
    {
        std::cerr << "保存失败!" << std::endl;
        return 1;
    }
    return 0;
}
```

## 六、VS2022 使用步骤

| 步骤 | 操作 |
| ---- | ---- |
| 1 | 建目录 `<项目根目录>\OpenCVTemplate`，放入上面 4 个文件 |
| 2 | 确认环境变量 `OpenCV_DIR` 已设、PATH 已加 OpenCV `bin`（没配先按 `环境配置.md` 配） |
| 3 | VS2022 → 文件 → 打开 → 文件夹 → 选项目根目录 |
| 4 | 底部状态栏配置选择器选 `debug`（或 `release`） |
| 5 | 顶部启动项选 `OpenCVTemplate.exe`，F5 构建运行 |

**验证：** 控制台打印 OpenCV 版本号；`out\build\debug\` 下生成 `test_output.png`，打开是红绿蓝渐变图。

## 七、常见问题

| 问题 | 原因 | 解决 |
| ---- | ---- | ---- |
| `Could not find OpenCVConfig.cmake` | `OpenCV_DIR` 没生效或值不对 | 确认它指向 `...\vc16\lib`（该目录含 `OpenCVConfig.cmake`），改完重启 VS |
| 运行时报找不到 `opencv_world4100d.dll` | PATH 没加 OpenCV `bin` | 确认 PATH 含 `<OpenCV安装目录>\build\x64\vc16\bin`，改完重启 VS |
| 链接报错找不到 `.lib` | Debug/Release 库文件不匹配 | Debug 用 `opencv_world4100d.lib`，Release 用 `opencv_world4100.lib`，确认 `lib` 目录里都在 |
| `LNK2038` 运行时库冲突 | 项目 /MT 而 OpenCV 是 /MD 构建 | 保持 MSVC 默认 /MD，不要手动改运行时库 |
