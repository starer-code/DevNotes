# Boost 模板（VS2022 + CMake + Ninja）

> **基于你的环境变量：**
> - `BOOST_ROOT = <Boost根目录>`
> - Boost 是**静态库**（vc143 构建），不用加 PATH，运行时不需要 dll
>
> 遵循 `项目约定.md`：CMake 唯一构建系统、依赖走环境变量 + `find_package`、构建输出在 `out/build/`、不写死路径。

## 一、目录结构

```
<项目根目录>\BoostTemplate\
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
project(BoostTemplate LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------- Boost ----------
# BOOST_ROOT 由 CMakePresets.json 从环境变量注入，这里不写路径
set(Boost_NO_SYSTEM_PATHS ON)     # 只从 BOOST_ROOT 找，不扫系统路径
set(Boost_USE_STATIC_LIBS ON)     # 用静态库（你编译的就是静态库）
set(Boost_USE_MULTITHREADED ON)   # 多线程版本

find_package(Boost 1.81 REQUIRED COMPONENTS filesystem system thread)

# ---------- 源文件 ----------
set(SOURCES
    src/main.cpp
)

add_executable(${PROJECT_NAME} ${SOURCES})

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    Boost::filesystem
    Boost::system
    Boost::thread
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
        "BOOST_ROOT": "$env{BOOST_ROOT}",
        "Boost_NO_SYSTEM_PATHS": "ON",
        "Boost_USE_STATIC_LIBS": "ON",
        "Boost_USE_MULTITHREADED": "ON"
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
#include <boost/version.hpp>
#include <boost/filesystem.hpp>
#include <boost/thread.hpp>
#include <iostream>

namespace fs = boost::filesystem;

int main()
{
    std::cout << "Boost 版本: " << BOOST_LIB_VERSION << std::endl;

    // filesystem：打印当前工作目录
    std::cout << "当前目录: " << fs::current_path().string() << std::endl;

    // thread：起一个线程验证
    boost::thread t([] {
        std::cout << "Boost 线程运行中, id = "
                  << boost::this_thread::get_id() << std::endl;
    });
    t.join();

    return 0;
}
```

## 六、VS2022 使用步骤

| 步骤 | 操作 |
| ---- | ---- |
| 1 | 建目录 `<项目根目录>\BoostTemplate`，放入上面 4 个文件 |
| 2 | 确认环境变量 `BOOST_ROOT` 已设（没配先按 `环境配置.md` 配） |
| 3 | VS2022 → 文件 → 打开 → 文件夹 → 选项目根目录 |
| 4 | 底部状态栏配置选择器选 `debug`（或 `release`） |
| 5 | 顶部启动项选 `BoostTemplate.exe`，F5 构建运行 |

**验证：** 控制台打印 Boost 版本号、当前工作目录、线程 id，三行都有就说明 filesystem 和 thread 都链接成功。

## 七、常见问题

| 问题 | 原因 | 解决 |
| ---- | ---- | ---- |
| `Could not find BoostConfig.cmake` 或找不到 Boost | `BOOST_ROOT` 没生效 | 确认指向 `<Boost根目录>`（其下 `stage\lib\cmake\Boost-1.81.0\BoostConfig.cmake` 存在），改完重启 VS |
| 链接报错找不到 `libboost_filesystem-vc143-mt-x64-1_81.lib` | 库路径没找到 | 确认 `<Boost根目录>\stage\lib` 下有该文件；Debug 版文件名带 `-gd-` |
| `fatal error C1083` 找不到 `boost/xxx.hpp` | include 路径没生效 | 检查 `BOOST_ROOT` 是否指向含 `boost\` 子目录的根 |
| `LNK2038` 运行时库冲突 | Boost 静态库是 /MD 构建，项目被改成 /MT | 保持 MSVC 默认 /MD，不要设 `Boost_USE_STATIC_RUNTIME` |
| 链接大量重复符号或警告 | 把 header-only 库也强行链接了 | 只需链接需要编译的库（filesystem/system/thread），其余 `#include` 即可 |
| `boost::system` 符号找不到 | system 库没链上 | 确认 `Boost::system` 在 `target_link_libraries` 里 |
