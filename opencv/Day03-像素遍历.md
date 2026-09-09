# OpenCV Day03 - 像素遍历

> 两种访问像素的方式：at<> 和 ptr<>

## 方式一：at<> 直接访问

通过行列索引直接访问像素，代码简洁但每次访问都有边界检查开销。

```cpp
// 单通道（灰度图）
uchar pixel = image.at<uchar>(i, j);
image.at<uchar>(i, j) = 255 - pixel;

// 三通道（彩色图）
Vec3b pixel = image.at<Vec3b>(i, j);
pixel[0] = 255 - pixel[0]; // B
pixel[1] = 255 - pixel[1]; // G
pixel[2] = 255 - pixel[2]; // R
image.at<Vec3b>(i, j) = pixel;
```

## 方式二：ptr<> 指针访问

获取行首指针后直接偏移，性能更优（无边界检查）。

```cpp
// 单通道
uchar* rowPtr = image.ptr<uchar>(i);
rowPtr[j] = 255 - rowPtr[j];

// 三通道
Vec3b* rowPtr = image.ptr<Vec3b>(i);
Vec3b pixel = rowPtr[j];
pixel[0] = 255 - pixel[0];
pixel[1] = 255 - pixel[1];
pixel[2] = 255 - pixel[2];
rowPtr[j] = pixel;
```

## 对比

| 特性 | at<> | ptr<> |
|------|------|-------|
| 语法 | 简洁直观 | 需理解指针 |
| 性能 | 每次边界检查，较慢 | 无边界检查，较快 |
| 适用 | 小批量访问、调试 | 大图遍历、性能敏感 |

## 反转图像示例（完整）

```cpp
void invertImage(Mat& image) {
    int w = image.cols;
    int h = image.rows;
    int channels = image.channels();
    
    for (int i = 0; i < h; i++) {
        uchar* rowPtr = image.ptr<uchar>(i);
        for (int j = 0; j < w * channels; j++) {
            rowPtr[j] = 255 - rowPtr[j];
        }
    }
    imshow("Inverted", image);
}
```

> 可用 `rowPtr[j] = 255 - rowPtr[j]` 一次处理所有通道，无需区分通道数。
