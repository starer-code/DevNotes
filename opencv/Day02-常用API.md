# OpenCV Day02 - 常用API

> 图像读取、显示、颜色空间转换

## 1. 图像读取与显示

```cpp
#include <opencv2/opencv.hpp>
using namespace cv;

int main() {
    // 读取图像
    Mat img = imread("test.jpg");
    
    // 显示图像
    imshow("窗口名", img);
    
    // 等待按键
    waitKey(0);
    
    return 0;
}
```

## 2. 灰度图转换

```cpp
Mat gray;
cvtColor(img, gray, COLOR_BGR2GRAY);
imshow("灰度图", gray);
```

## 3. HSV 图像转换

```cpp
Mat hsv;
cvtColor(img, hsv, COLOR_BGR2HSV);
imshow("HSV", hsv);
```

## 4. 常用颜色空间

| 转换 | 常量 |
|------|------|
| BGR → 灰度 | `COLOR_BGR2GRAY` |
| BGR → HSV | `COLOR_BGR2HSV` |
| BGR → RGB | `COLOR_BGR2RGB` |
| 灰度 → BGR | `COLOR_GRAY2BGR` |

## 5. 图像保存

```cpp
imwrite("output.jpg", gray);
```

## 6. 获取图像信息

```cpp
int width = img.cols;      // 宽度
int height = img.rows;     // 高度
int channels = img.channels(); // 通道数
```
