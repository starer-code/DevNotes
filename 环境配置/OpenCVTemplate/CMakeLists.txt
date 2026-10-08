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
