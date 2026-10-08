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
