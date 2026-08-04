---
title: QMovie 动画播放
tag: Qt
搬运转载: 否
---

# QMovie 动画播放

`QMovie` 是 Qt 中用于播放动画（主要是 `GIF` 格式）的类。它本身不是一个控件，不能直接显示在界面上，通常需要借助 `QLabel`（或 `QGraphicsView`）来展示播放效果。

它的核心作用是：逐帧读取动图文件，按时间间隔把每一帧渲染出来，从而实现动画播放。

# 1. 效果演示

通过 `QLabel` 显示一个加载中的 GIF 动画，并提供「开始 / 暂停 / 停止」三个按钮，演示 `QMovie` 的常用接口。

# 2. 属性和方法

`QMovie` 的工作流程大致是：`加载文件 → 启动播放 → 播放结束`。常用的属性和方法如下。

## 2.1 构造与加载

```cpp
// 通过文件名构造
QMovie(const QString &fileName, const QByteArray &format = QByteArray(), QObject *parent = nullptr);

// 通过 QIODevice 构造（可用于资源文件、网络数据等）
QMovie(QIODevice *device, const QByteArray &format = QByteArray(), QObject *parent = nullptr);

// 设置 / 获取动画的文件名
void setFileName(const QString &fileName);
QString fileName() const;

// 判断动画是否有效（文件是否能被正确解析）
bool isValid() const;
```

## 2.2 播放控制

```cpp
// 开始播放
void start();

// 暂停 / 继续
void setPaused(bool paused);   // true 为暂停，false 为继续
void pause();
// 停止播放，并回到第一帧
void stop();

// 判断当前播放状态
CacheMode cacheMode() const;
void setCacheMode(CacheMode mode);
```

`QMovie` 提供的播放控制比较简单，注意 `stop()` 与 `pause()` 的区别：

- `pause()`：暂停在当前帧，再次调用可继续播放
- `stop()`：停止播放并把当前帧重置到第 0 帧

## 2.3 速度与缩放

```cpp
// 获取 / 设置播放速度，100 表示原速，200 表示 2 倍速，50 表示 0.5 倍速
int speed() const;
void setSpeed(int percentSpeed);

// 获取 / 设置动画缩放后的尺寸
QSize scaledSize();
void setScaledSize(const QSize &size);
```

`setSpeed()` 接受百分比形式的速度值，范围一般为 `[1, 100]` 之外的也支持，但常用区间是 `25`（0.25 倍）到 `400`（4 倍）。

## 2.4 帧信息

```cpp
// 获取当前帧的图像
QPixmap currentPixmap() const;
QImage currentImage() const;

// 获取 / 跳转到某一帧
int currentFrameNumber() const;
bool jumpToFrame(int frameNumber);

// 获取动画总帧数
int frameCount() const;   // 部分格式无法统计，会返回 0

// 获取 / 设置每帧之间的延迟（毫秒）
int nextFrameDelay() const;
void setNextFrameDelay(int milliseconds);
```

## 2.5 信号

`QMovie` 常用的信号如下：

```cpp
// 动画开始播放时发射
void started();

// 播放暂停时发射
void paused();

// 播放恢复时发射
void resumed();

// 播放停止时发射
void finished();

// 出错时发射，error 为错误码
void error(QMovie::MovieError error);

// 每当切换到新的一帧时发射（最常用，可用于同步处理每一帧）
void frameChanged(int frameNumber);
```

# 3. 从零实现

## 3.1 布局

在 UI 设计师界面拖入一个 `QLabel`（用于显示动画）和三个按钮「开始 / 暂停 / 停止」，并修改对应的 `objectName` 与文本，完成布局。

## 3.2 代码实现

首先，在 `mywidget.h` 中声明成员变量与槽函数：

```cpp
// mywidget.h
#include <QMovie>

class MyWidget : public QWidget {
    Q_OBJECT
public:
    explicit MyWidget(QWidget* parent = nullptr);
    ~MyWidget();

private slots:
    void onStartClicked();
    void onPauseClicked();
    void onStopClicked();
    void onFrameChanged(int frameNumber);

private:
    Ui::MyWidget* ui;
    QMovie* movie;
};
```

然后，在 `mywidget.cpp` 中进行初始化与信号槽连接：

```cpp
// mywidget.cpp
#include "mywidget.h"
#include "ui_mywidget.h"

MyWidget::MyWidget(QWidget* parent) : QWidget(parent), ui(new Ui::MyWidget) {
    ui->setupUi(this);
    setWindowTitle("明王讲QT | QMovie 动画播放");

    // 1. 创建 QMovie 并加载 GIF
    movie = new QMovie(this);

    // 方式一：直接使用文件路径
    movie->setFileName(":/image/loading.gif");

    // 方式二：也可以在构造时直接传入文件名
    // movie = new QMovie(":/image/loading.gif", QByteArray(), this);

    // 2. 判断动画是否加载成功
    if (!movie->isValid()) {
        qDebug() << "动画加载失败，请检查文件路径或格式";
    }

    // 3. 设置播放速度为 2 倍速
    movie->setSpeed(200);

    // 4. 将动画绑定到 QLabel 显示
    ui->label->setMovie(movie);

    // 5. 关联按钮信号
    connect(ui->btnStart, &QPushButton::clicked, this, &MyWidget::onStartClicked);
    connect(ui->btnPause, &QPushButton::clicked, this, &MyWidget::onPauseClicked);
    connect(ui->btnStop,  &QPushButton::clicked, this, &MyWidget::onStopClicked);

    // 6. 关联每一帧变化的信号
    connect(movie, &QMovie::frameChanged, this, &MyWidget::onFrameChanged);
}

MyWidget::~MyWidget() {
    delete ui;
}

void MyWidget::onStartClicked() {
    movie->start();
}

void MyWidget::onPauseClicked() {
    // 通过状态切换暂停 / 继续
    movie->setPaused(movie->state() == QMovie::Running);
}

void MyWidget::onStopClicked() {
    movie->stop();
}

void MyWidget::onFrameChanged(int frameNumber) {
    // 每切换一帧都会触发，可用于更新状态栏或处理其他逻辑
    qDebug() << "当前帧：" << frameNumber;
}
```

## 3.3 运行效果

点击「开始」按钮，`QLabel` 中开始播放 GIF 动画；点击「暂停」可暂停在当前帧，再次点击则继续播放；点击「停止」则停止播放并回到第一帧。状态栏（如有）会输出当前帧号。

# 4. 注意事项

1. **支持的格式有限**：`QMovie` 主要用于动画，最常见的是 `GIF`。`PNG`、`MNG` 等是否支持取决于底层的图像插件。视频文件（如 `mp4`）**无法**通过 `QMovie` 播放，需要借助多媒体模块（如 `QMediaPlayer`）。

2. **内存占用**：通过 `setCacheMode(QMovie::CacheAll)` 可以缓存所有帧以提升循环播放时的性能，但会占用更多内存。对于大尺寸 GIF，建议使用默认的 `QMovie::CacheNone`。

3. **配合 QLabel 显示**：`QLabel::setMovie()` 是最常用的显示方式。注意 `QLabel` 的 `scaledContents` 属性为 `true` 时会拉伸动画，如需保持比例缩放应使用 `QMovie::setScaledSize()`。

4. **播放循环**：GIF 文件本身可以包含循环信息。如需控制循环次数，可通过 `QMovie::loopCount()` 获取，但没有直接设置循环次数的接口；通常通过监听 `finished()` 信号手动重新 `start()` 以实现自定义循环逻辑。

5. **资源文件路径**：使用 `:/image/loading.gif` 这种带 `:/` 前缀的资源路径时，需确保 `.qrc` 文件中已正确注册该文件。