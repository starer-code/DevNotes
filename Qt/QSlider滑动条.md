---
title: QSlider 滑动条控件
tag: Qt
搬运转载: 是
原文地址: https://www.qt1024.cn/qt_basic/2_9_QSlider
---

> 本文搬运转载自 [明王讲QT - QSlider](https://www.qt1024.cn/qt_basic/2_9_QSlider)，仅供学习记录使用。版权归原作者所有。

# QSlider 滑动条控件

`QSlider`是滑动条控件
它允许用户通过拖动滑块来选择一个范围内的值。通常用于调整音量、亮度、进度等需要连续数值输入的场景

# 1. 效果演示三个滑动条，分别用来调节`RGB`三个颜色的值，并显示到左侧各自的文本框中
并且将`RGB`这三个颜色的组合，来设置上面的文本框的背景颜色
![](https://www-qt1024-cn.oss-cn-beijing.aliyuncs.com/slider.gif)

# 2. 属性和方法`QSlider`继承自`QAbstractSlider`，它的绝大多数属性都是从`QAbstractSlider`继承而来的。
`QSlider`有很多属性，完整的可查看帮助文档。这里仅列出常用的属性和方法

## 2.1 值滑动条和值相关的属性包括：当前值、最大值、最小值

```cpp
// 获取和设置当前值
int value() const;
void setValue(int);

// 获取和设置最大值
int maximum() const;
void setMaximum(int);

// 获取和设置最小值
int minimum() const;
void setMinimum(int);

// 一次设置最大值和最小值
void setRange(int min, int max)
```

## 2.2 方向`Qt`中滑动条有水平滑动条和垂直滑动条之分，通过修改`orientation`属性来设置

```cpp
// 获取和设置滑动条的方向
Qt::Orientation orientation() const;
void setOrientation(Qt::Orientation);
```

## 2.3 步长步长是指滑动条一次增加或减少的值。这里又包括两个步长：

- singleStep：是指按键盘的左右箭头（←/→）时的步长
- pageStep：是指点击滑块两侧时的步长

```cpp
// 获取和设置singleStep
int singleStep() const;
void setSingleStep(int);

// 获取和设置pageStep
int pageStep() const;
void setPageStep(int);
```

## 2.4 刻度线```cpp
// 获取和设置刻度线间隔
int tickInterval() const
void setTickInterval(int ti)
 
// 获取和设置刻度线的位置
QSlider::TickPosition tickPosition() const
void setTickPosition(QSlider::TickPosition position)
```

## 2.5 信号槽QSlider 常用的信号，如下：

```cpp
// 当滑块被按下、移动、释放时发射的信号
void sliderPressed();
void sliderMoved(int value);
void sliderReleased();

// 当滑动条的值改变时，发射该信号
void valueChanged(int value);
```

# 3. 从零实现从零写代码实现整体效果，以演示滑动条的属性以及信号槽的用法

## 3.1 布局在UI设计师界面，拖拽对应的控件，修改显示的文字、控件的名称，然后完成布局
在右侧的属性窗口中，将`MyWidget`窗口的`Point Size`属性修改为`14`
布局完成效果如下：
![](https://www-qt1024-cn.oss-cn-beijing.aliyuncs.com/image-20260319225311185.png)

## 3.2 代码实现首先，来到`mywidget.cpp`中，对控件属性进行设置
为方便处理，将三个滑动条以及它们对应的属性放到列表中，如下：

```cpp
MyWidget::MyWidget(QWidget* parent) : QWidget(parent), ui(new Ui::MyWidget) {
    ui->setupUi(this);
    setWindowTitle("明王讲QT | 第二章 常用控件 | 2.9 滑动条QSlider");

    // 1. 初始化滑动条属性
    QList<QSlider*> sliders;
    sliders << ui->sliderRed << ui->sliderGreen << ui->sliderBlue;

    QList<QList<int>> props = {
        // Minimum、Maximum、SingleStep、PageStep
        {0, 255, 1, 10},
        {0, 255, 5, 20},
        {0, 255, 10, 50}  //
    };

    for ( int i = 0; i < sliders.size(); i++ ) {
        sliders[i]->setMinimum(props[i][0]);
        sliders[i]->setMaximum(props[i][1]);
        // sliders[i]->setRange(props[i][0], props[i][1]);

        sliders[i]->setSingleStep(props[i][2]);
        sliders[i]->setPageStep(props[i][3]);

        // sliders[i]->setTickPosition(QSlider::TicksAbove);
        // sliders[i]->setTickInterval(50);

        sliders[i]->setOrientation(Qt::Horizontal);
    }

    // 2. 回显
    int red = ui->sliderRed->value();
    int green = ui->sliderGreen->value();
    int blue = ui->sliderBlue->value();

    ui->lineEditRed->setText(QString::number(red));
    ui->lineEditGreen->setText(QString::number(green));
    ui->lineEditBlue->setText(QString::number(blue));

    QString style = QString("background-color: rgb(%1, %2, %3);").arg(red).arg(green).arg(blue);
    ui->textEdit->setStyleSheet(style);
}
```
此时，运行效果：
![](https://www-qt1024-cn.oss-cn-beijing.aliyuncs.com/image-20260319225346034.png)

然后，在`mywidget.h`中声明槽函数，并在`mywidget.cpp`中实现，如下：

```cpp
// mywidget.h
class MyWidget : public QWidget {

private slots:
    void onValueChanged(int value);
};

// mywidget.cpp
void MyWidget::onValueChanged(int value) {
    // 1、获取rgb的颜色值
    int red = ui->sliderRed->value();
    int green = ui->sliderGreen->value();
    int blue = ui->sliderBlue->value();

#if 0
    // 判断是哪个滑动条触发的槽函数
    QObject *obj = sender();
    if (obj) {
        QSlider *slider = qobject_cast<QSlider *>(obj);
        if (slider == ui->sliderRed) {

        }
    }
#endif

    // 2. 将颜色值显示到文本框
    ui->lineEditRed->setText(QString::number(red));
    ui->lineEditGreen->setText(QString::number(green));
    ui->lineEditBlue->setText(QString::number(blue));

    // 3、拼接样式字符串，设置textEdit背景色
    QString style = QString("background-color: rgb(%1, %2, %3);").arg(red).arg(green).arg(blue);
    // qDebug() << style;
    ui->textEdit->setStyleSheet(style);
}
```

最后，别忘了在`mywidget.cpp`的构造函数中，关联信号和槽，如下：

```cpp
MyWidget::MyWidget(QWidget* parent) : QWidget(parent), ui(new Ui::MyWidget) {
    
    // 3. 关联信号槽
    connect(ui->sliderRed, &QSlider::valueChanged, this, &MyWidget::onValueChanged);
    connect(ui->sliderGreen, &QSlider::valueChanged, this, &MyWidget::onValueChanged);
    connect(ui->sliderBlue, &QSlider::valueChanged, this, &MyWidget::onValueChanged);
}
```

# 4. 点赞、获取源码看到这里的小伙伴，去B站给明王一个【免费的点赞】吧，你的支持，是我持续更新优质内容的动力，感谢~

源码下载地址
链接: [https://pan.baidu.com/s/1r9nk9Zp4i2jgQzcazWXGEw](https://pan.baidu.com/s/1r9nk9Zp4i2jgQzcazWXGEw)
提取码: ming
