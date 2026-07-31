# QWidget 深入详解

## 目录

- [1. 什么是 QWidget](#1-什么是-qwidget)
- [2. QWidget 的继承体系](#2-qwidget-的继承体系)
- [3. 创建与基本使用](#3-创建与基本使用)
- [4. 窗口属性](#4-窗口属性)
- [5. 几何布局与坐标系统](#5-几何布局与坐标系统)
- [6. 事件系统](#6-事件系统)
- [7. 绘制系统](#7-绘制系统)
- [8. 样式表 (QSS)](#8-样式表-qss)
- [9. 布局管理](#9-布局管理)
- [10. 子控件与层级管理](#10-子控件与层级管理)
- [11. 自定义控件实战](#11-自定义控件实战)
- [12. 性能优化](#12-性能优化)
- [13. 常见陷阱与最佳实践](#13-常见陷阱与最佳实践)
- [14. 总结](#14-总结)

---

## 1. 什么是 QWidget

`QWidget` 是 Qt 框架中所有用户界面对象的基类。它既是"控件"（widget），也是"窗口"（window）。在 Qt 的世界里，几乎所有可见元素都是 `QWidget`——按钮、标签、输入框、对话框，乃至整个应用程序的主窗口。

> **核心要点**：QWidget 是一个"空白的矩形区域"，它知道如何绘制自己、如何处理鼠标键盘事件、如何管理子控件。你可以在它之上构建任意复杂的 UI。

### 核心职责

| 职责 | 说明 |
|------|------|
| 窗口管理 | 最小化、最大化、关闭、标题栏 |
| 绘制 | 通过 `paintEvent` 自绘外观 |
| 事件处理 | 鼠标、键盘、触控、拖放等 |
| 子控件管理 | 添加、删除、查找子控件 |
| 布局管理 | 与 QLayout 协作自动排列子控件 |
| 样式设置 | 通过 QSS 或 QPalette 定制外观 |

---

## 2. QWidget 的继承体系

```
QObject
 └── QPaintDevice
      └── QWidget               ← 本文主角
           ├── QFrame
           │    ├── QLabel
           │    ├── QAbstractScrollArea
           │    └── ...
           ├── QAbstractButton
           │    ├── QPushButton
           │    ├── QCheckBox
           │    ├── QRadioButton
           │    └── ...
           ├── QComboBox
           ├── QLineEdit
           ├── QSlider
           ├── QSpinBox
           ├── QDialog
           ├── QMainWindow
           └── ...
```

- **QObject**：提供了信号槽机制、对象树管理、事件过滤器等基础设施。
- **QPaintDevice**：声明了"可以被绘制"的能力，提供了绘制设备的抽象接口。
- **QWidget**：将两者结合，成为一个**可交互、可绘制、可包含子对象的矩形区域**。

---

## 3. 创建与基本使用

### 3.1 最简单的 QWidget

```cpp
#include <QApplication>
#include <QWidget>

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);

    QWidget w;
    w.setWindowTitle("Hello QWidget");
    w.resize(400, 300);
    w.show();

    return app.exec();
}
```

### 3.2 创建自定义 QWidget 子类

```cpp
// MyWidget.h
#pragma once
#include <QWidget>
#include <QPainter>

class MyWidget : public QWidget
{
    Q_OBJECT  // 启用信号槽、元对象特性
public:
    explicit MyWidget(QWidget *parent = nullptr);

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
};
```

```cpp
// MyWidget.cpp
#include "MyWidget.h"
#include <QPainter>

MyWidget::MyWidget(QWidget *parent)
    : QWidget(parent)
{
    setMinimumSize(200, 150);
}

void MyWidget::paintEvent(QPaintEvent *)
{
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setBrush(QColor(100, 150, 255));
    painter.drawRoundedRect(rect().adjusted(5, 5, -5, -5), 10, 10);
}

void MyWidget::mousePressEvent(QMouseEvent *event)
{
    // 点击时改变颜色
    Q_UNUSED(event);
    update();
}
```

### 3.3 对象树与父子关系

QWidget 的构造函数接受一个 `parent` 参数：

```cpp
QWidget *parent = new QWidget();
QWidget *child  = new QWidget(parent);  // child 成为 parent 的子控件
```

- 父对象析构时自动析构所有子对象——**无需手动 delete**。
- 子控件默认在父控件的坐标系统中显示。
- 子控件默认被父控件裁剪（超出父区域的部分不显示）。

---

## 4. 窗口属性

### 4.1 窗口类型与标志

使用 `setWindowFlags()` 控制窗口行为：

```cpp
// 常见窗口标志
w.setWindowFlags(Qt::Dialog);                // 对话框类型
w.setWindowFlags(Qt::WindowStaysOnTopHint);   // 置顶
w.setWindowFlags(Qt::FramelessWindowHint);    // 无边框
w.setWindowFlags(Qt::Tool);                   // 工具窗口
w.setWindowFlags(Qt::Popup);                  // 弹出式
```

### 4.2 窗口状态

```cpp
w.showMinimized();          // 最小化
w.showMaximized();          // 最大化
w.showFullScreen();         // 全屏
w.showNormal();             // 恢复正常
w.setWindowState(Qt::WindowFullScreen);  // 同上，但不会触发动画
```

### 4.3 透明度

```cpp
w.setWindowOpacity(0.7);    // 0.0(完全透明) ~ 1.0(不透明)
w.setAttribute(Qt::WA_TranslucentBackground);  // 支持透明背景（配合 paintEvent）
```

### 4.4 启用/禁用

```cpp
w.setEnabled(false);    // 禁用整个控件（灰显，不响应事件）
w.setVisible(true);     // 显示
w.hide();               // 隐藏（等价于 setVisible(false)）
```

---

## 5. 几何布局与坐标系统

### 5.1 坐标系统

QWidget 使用左上角为原点的坐标系统：

```
(0,0) ──────→ x 正方向
  │
  │
  ↓
  y 正方向
```

### 5.2 关键几何方法

| 方法 | 含义 |
|------|------|
| `x(), y()` | 相对于父控件的左上角坐标 |
| `pos()` | 返回 `QPoint(x, y)` |
| `width(), height()` | 内部宽高（不含窗口边框） |
| `size()` | 返回 `QSize(width, height)` |
| `geometry()` | 返回 `QRect(x, y, w, h)`——相对于父控件 |
| `rect()` | 返回 `QRect(0, 0, w, h)`——自身坐标系 |
| `frameGeometry()` | 包含窗口边框的矩形 |
| `setGeometry(x, y, w, h)` | 设置位置和大小 |
| `resize(w, h)` | 仅设置大小 |
| `move(x, y)` | 仅设置位置 |
| `adjustSize()` | 根据内容自动调整大小 |

### 5.3 坐标转换

```cpp
// 子控件坐标 → 父控件坐标
QPoint globalPt = child->mapToParent(QPoint(0, 0));

// 子控件坐标 → 屏幕坐标
QPoint screenPt = child->mapToGlobal(QPoint(0, 0));

// 屏幕坐标 → 子控件坐标
QPoint localPt = child->mapFromGlobal(screenPt);
```

### 5.4 最小/最大尺寸

```cpp
w.setMinimumSize(200, 100);
w.setMaximumSize(800, 600);
w.setFixedSize(400, 300);        // 等价于 min == max
w.setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
```

`QSizePolicy` 是布局中控件如何伸缩的策略：

| 策略 | 含义 |
|------|------|
| `Fixed` | 固定大小，不伸缩 |
| `Minimum` | 可以变大但不能变小 |
| `Maximum` | 可以变小但不能变大 |
| `Preferred` | 首选大小，可以伸缩 |
| `Expanding` | 尽可能占用额外空间 |
| `MinimumExpanding` | 最小尺寸后尽可能扩展 |
| `Ignored` | 忽略尺寸提示，完全由布局决定 |

---

## 6. 事件系统

### 6.1 常见事件与对应虚函数

| 事件 | 虚函数 | 触发时机 |
|------|--------|----------|
| 绘制 | `paintEvent` | 需要重绘时 |
| 鼠标按下 | `mousePressEvent` | 鼠标按键按下 |
| 鼠标释放 | `mouseReleaseEvent` | 鼠标按键释放 |
| 鼠标移动 | `mouseMoveEvent` | 鼠标移动（需追踪） |
| 鼠标双击 | `mouseDoubleClickEvent` | 鼠标双击 |
| 滚轮 | `wheelEvent` | 滚轮滚动 |
| 键盘按下 | `keyPressEvent` | 按键按下 |
| 键盘释放 | `keyReleaseEvent` | 按键释放 |
| 进入 | `enterEvent` | 鼠标进入控件区域 |
| 离开 | `leaveEvent` | 鼠标离开控件区域 |
| 大小变化 | `resizeEvent` | 控件大小改变 |
| 移动 | `moveEvent` | 控件位置改变 |
| 显示 | `showEvent` | 控件变为可见 |
| 隐藏 | `hideEvent` | 控件变为隐藏 |
| 关闭 | `closeEvent` | 关闭控件 |
| 拖放进入 | `dragEnterEvent` | 拖放进入 |
| 拖放 | `dropEvent` | 拖放释放 |
| 焦点进入 | `focusInEvent` | 获得焦点 |
| 焦点离开 | `focusOutEvent` | 失去焦点 |
| 上下文菜单 | `contextMenuEvent` | 右键菜单请求 |
| 输入法 | `inputMethodEvent` | 输入法事件 |

### 6.2 事件处理示例

```cpp
void MyWidget::mousePressEvent(QMouseEvent *event)
{
    if (event->button() == Qt::LeftButton) {
        m_dragging = true;
        m_dragPos = event->pos();
        setCursor(Qt::ClosedHandCursor);
    }
}

void MyWidget::mouseMoveEvent(QMouseEvent *event)
{
    if (m_dragging) {
        QPoint delta = event->pos() - m_dragPos;
        move(pos() + delta);
    }
}

void MyWidget::mouseReleaseEvent(QMouseEvent *event)
{
    if (event->button() == Qt::LeftButton && m_dragging) {
        m_dragging = false;
        setCursor(Qt::ArrowCursor);
    }
}

void MyWidget::keyPressEvent(QKeyEvent *event)
{
    switch (event->key()) {
    case Qt::Key_Escape:
        close();
        break;
    case Qt::Key_Space:
        toggleState();
        break;
    default:
        QWidget::keyPressEvent(event);  // 转发给父类
    }
}
```

### 6.3 事件过滤器

事件过滤器允许一个对象监听另一个对象的所有事件：

```cpp
class Controller : public QObject
{
protected:
    bool eventFilter(QObject *obj, QEvent *event) override
    {
        if (event->type() == QEvent::MouseButtonPress) {
            auto *w = qobject_cast<QWidget *>(obj);
            if (w) {
                qDebug() << "Clicked:" << w->objectName();
            }
        }
        return false;  // false = 继续处理, true = 拦截
    }
};

// 使用
Controller *ctrl = new Controller(this);
childWidget->installEventFilter(ctrl);
```

### 6.4 自定义事件

```cpp
// 定义自定义事件类型
static const QEvent::Type MyCustomEventType =
    static_cast<QEvent::Type>(QEvent::registerEventType());

class MyCustomEvent : public QEvent
{
public:
    MyCustomEvent(int data)
        : QEvent(MyCustomEventType), m_data(data) {}
    int data() const { return m_data; }
private:
    int m_data;
};

// 发送事件（同步）
QApplication::sendEvent(receiver, new MyCustomEvent(42));

// 投递事件（异步）
QApplication::postEvent(receiver, new MyCustomEvent(42));
```

---

## 7. 绘制系统

QWidget 的绘制通过重写 `paintEvent()` 实现，使用 `QPainter` 进行绘制。

### 7.1 基本绘制

```cpp
void MyWidget::paintEvent(QPaintEvent *event)
{
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);

    // 背景
    painter.fillRect(rect(), QColor(240, 240, 245));

    // 绘制文本
    painter.setPen(QColor(50, 50, 50));
    painter.setFont(QFont("Arial", 14, QFont::Bold));
    painter.drawText(rect(), Qt::AlignCenter, "Hello, QWidget!");

    // 绘制矩形
    painter.setPen(QPen(QColor(100, 150, 255), 2));
    painter.setBrush(QColor(100, 150, 255, 80));
    painter.drawRoundedRect(50, 50, 200, 100, 8, 8);

    // 绘制线条
    painter.drawLine(10, 10, 300, 200);

    // 绘制椭圆
    painter.drawEllipse(QPoint(200, 150), 50, 30);

    // 绘制弧线
    painter.drawArc(QRect(50, 50, 100, 100), 0, 180 * 16);

    // 绘制多边形
    QPolygon polygon;
    polygon << QPoint(100, 10) << QPoint(150, 60) << QPoint(50, 60);
    painter.drawPolygon(polygon);
}
```

### 7.2 双缓冲与更新机制

QWidget 默认使用**双缓冲**——所有绘制先绘制到离屏像素图，再一次复制到屏幕，防止闪烁。

```cpp
// 请求重绘（异步，合并多次请求为一次绘制）
widget->update();

// 请求重绘指定区域（更高效）
widget->update(10, 10, 100, 50);

// 立即重绘（同步，一般不推荐）
widget->repaint();
```

> **规则**：总是调用 `update()` 而不是 `repaint()`，除非你明确需要同步绘制。`update()` 会将多个请求合并到一次 `paintEvent` 调用中，性能更好。

### 7.3 QPainter 常用 API

| 类别 | 方法 |
|------|------|
| 基本形状 | `drawPoint`, `drawLine`, `drawRect`, `drawRoundedRect` |
| 高级形状 | `drawEllipse`, `drawArc`, `drawChord`, `drawPie` |
| 路径 | `drawPath`, `QPainterPath` |
| 文本 | `drawText`, `drawStaticText`, `boundingRect` |
| 图像 | `drawImage`, `drawPixmap`, `drawPicture` |
| 填充 | `fillRect`, `eraseRect` |
| 变换 | `translate`, `scale`, `rotate`, `shear` |
| 状态 | `save`, `restore` |

### 7.4 绘制抗锯齿

```cpp
painter.setRenderHint(QPainter::Antialiasing, true);
painter.setRenderHint(QPainter::TextAntialiasing, true);
painter.setRenderHint(QPainter::SmoothPixmapTransform, true);
```

---

## 8. 样式表 (QSS)

QSS（Qt Style Sheets）语法与 CSS 类似，用于定制控件外观。

### 8.1 基本用法

```cpp
// 全局样式
qApp->setStyleSheet(R"(
    QWidget {
        background-color: #f0f0f0;
        font-family: "Microsoft YaHei";
        font-size: 13px;
    }
    QPushButton {
        background-color: #4A90D9;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 6px 16px;
    }
    QPushButton:hover {
        background-color: #357ABD;
    }
    QPushButton:pressed {
        background-color: #2A5F9E;
    }
    QPushButton:disabled {
        background-color: #cccccc;
        color: #888888;
    }
)");

// 单个控件
button->setStyleSheet("background-color: red; color: white;");

// 指定对象名
label->setObjectName("titleLabel");
label->setStyleSheet("QLabel#titleLabel { font-size: 20px; font-weight: bold; }");
```

### 8.2 QSS 选择器

| 选择器 | 示例 | 含义 |
|--------|------|------|
| 类型 | `QPushButton` | 匹配所有 QPushButton |
| 对象名 | `#myBtn` | 匹配 objectName == "myBtn" 的控件 |
| 类 | `.QPushButton` | 匹配 QPushButton 及其子类 |
| 子控件 | `QComboBox::drop-down` | 匹配下拉箭头区域 |
| 伪状态 | `QPushButton:hover` | 鼠标悬停状态 |
| 后代 | `QDialog QPushButton` | 匹配 QDialog 内的 QPushButton |
| 子项 | `QWidget > QPushButton` | 匹配直接子控件 |

### 8.3 盒模型

QSS 使用与 CSS 相同的盒模型：

```
 ┌─────────────────────────────────┐
 │         margin (外边距)          │
 │  ┌───────────────────────────┐  │
 │  │       border (边框)        │  │
 │  │  ┌─────────────────────┐  │  │
 │  │  │     padding (内边距)  │  │  │
 │  │  │  ┌───────────────┐  │  │  │
 │  │  │  │    content     │  │  │  │
 │  │  │  │   (内容区)      │  │  │  │
 │  │  │  └───────────────┘  │  │  │
 │  │  └─────────────────────┘  │  │
 │  └───────────────────────────┘  │
 └─────────────────────────────────┘
```

### 8.4 常用 QSS 属性

```cpp
button->setStyleSheet(R"(
    QPushButton {
        /* 背景 */
        background-color: #4A90D9;
        background-image: url(:/icons/btn_bg.png);
        /* 边框 */
        border: 2px solid #2A5F9E;
        border-radius: 5px;
        /* 字体 */
        color: white;
        font: bold 14px "Microsoft YaHei";
        /* 内边距 */
        padding: 8px 20px;
        /* 最小宽高 */
        min-width: 80px;
        min-height: 30px;
    }
)");
```

### 8.5 QPalette（调色板）

QSS 之外另一种定制颜色的方式：

```cpp
QPalette pal = widget->palette();
pal.setColor(QPalette::Window, QColor(240, 240, 245));
pal.setColor(QPalette::WindowText, QColor(50, 50, 50));
pal.setColor(QPalette::Button, QColor(74, 144, 217));
pal.setColor(QPalette::ButtonText, Qt::white);
pal.setColor(QPalette::Highlight, QColor(74, 144, 217));
widget->setPalette(pal);
```

> 推荐使用 QSS，更灵活可维护。QPalette 适合简单的整体配色。

---

## 9. 布局管理

布局管理器自动处理子控件的位置和大小。

### 9.1 内置布局

| 布局类 | 行为 |
|--------|------|
| `QHBoxLayout` | 水平排列 |
| `QVBoxLayout` | 垂直排列 |
| `QGridLayout` | 网格排列 |
| `QFormLayout` | 表单排列（标签+控件） |
| `QStackedLayout` | 栈式切换 |

### 9.2 基本用法

```cpp
QWidget *panel = new QWidget();
QVBoxLayout *layout = new QVBoxLayout(panel);  // 关联到 panel

layout->addWidget(new QPushButton("Button 1"));
layout->addWidget(new QPushButton("Button 2"));
layout->addWidget(new QPushButton("Button 3"));
layout->addStretch();  // 添加弹性空间
```

### 9.3 嵌套布局

```cpp
QWidget *mainWidget = new QWidget();

// 主水平布局
QHBoxLayout *mainLayout = new QHBoxLayout(mainWidget);

// 左侧垂直面板
QVBoxLayout *leftPanel = new QVBoxLayout();
leftPanel->addWidget(new QPushButton("Open"));
leftPanel->addWidget(new QPushButton("Save"));
leftPanel->addStretch();

// 右侧网格
QGridLayout *rightGrid = new QGridLayout();
rightGrid->addWidget(new QLabel("Name:"), 0, 0);
rightGrid->addWidget(new QLineEdit(), 0, 1);
rightGrid->addWidget(new QLabel("Age:"), 1, 0);
rightGrid->addWidget(new QSpinBox(), 1, 1);

mainLayout->addLayout(leftPanel);
mainLayout->addLayout(rightGrid);
```

### 9.4 布局控制

```cpp
// 边距
layout->setContentsMargins(10, 10, 10, 10);  // left, top, right, bottom

// 间距
layout->setSpacing(8);

// 伸缩因子
layout->addWidget(button1, 1);  // stretch factor = 1
layout->addWidget(button2, 3);  // stretch factor = 3（占 3 倍空间）

// 对齐
layout->addWidget(button, 0, Qt::AlignCenter);

// QGridLayout 控制
grid->addWidget(widget, row, col, rowSpan, colSpan, alignment);
```

### 9.5 大小策略

控件通过 `setSizePolicy` 告诉布局管理器如何伸缩：

```cpp
widget->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
widget->setMinimumSize(100, 50);
widget->setMaximumSize(500, 200);
```

如果布局结果不符合预期，检查控件的 `sizePolicy` 和 `minimumSize` / `maximumSize`。

---

## 10. 子控件与层级管理

### 10.1 查找子控件

```cpp
// 按类型和对象名查找
QPushButton *btn = parent->findChild<QPushButton *>("myButton");

// 查找所有匹配的子控件
QList<QPushButton *> allBtns = parent->findChildren<QPushButton *>();

// 递归查找
QWidget *child = parent->findChild<QWidget *>("deepChild", Qt::FindChildrenRecursively);
```

### 10.2 子控件枚举

```cpp
const auto children = parentWidget->children();  // QObjectList
for (QObject *obj : children) {
    if (obj->isWidgetType()) {
        auto *w = static_cast<QWidget *>(obj);
        // 处理 w
    }
}
```

### 10.3 子控件 Z 序

```cpp
// 提升到最前
widget->raise();

// 降到最低
widget->lower();

// 放到指定兄弟之前
widget->stackUnder(sibling);
```

### 10.4 焦点管理

```cpp
// 设置焦点策略
widget->setFocusPolicy(Qt::StrongFocus);    // Tab + 点击
widget->setFocusPolicy(Qt::ClickFocus);     // 仅点击
widget->setFocusPolicy(Qt::TabFocus);       // 仅 Tab
widget->setFocusPolicy(Qt::NoFocus);        // 不接受焦点

// 设置焦点
widget->setFocus();
widget->setFocus(Qt::TabFocusReason);       // 带原因

// 焦点切换
widget->focusNextChild();
widget->focusPreviousChild();

// Tab 顺序
QWidget::setTabOrder(first, second);        // Tab 从 first 到 second
```

---

## 11. 自定义控件实战

### 11.1 自定义圆形进度条

```cpp
// CircleProgress.h
#pragma once
#include <QWidget>

class CircleProgress : public QWidget
{
    Q_OBJECT
    Q_PROPERTY(int value READ value WRITE setValue NOTIFY valueChanged)
public:
    explicit CircleProgress(QWidget *parent = nullptr);

    int value() const { return m_value; }
    void setValue(int value);
    void setRange(int min, int max);
    void setLineWidth(int width);

signals:
    void valueChanged(int value);

protected:
    void paintEvent(QPaintEvent *event) override;

private:
    int m_min = 0;
    int m_max = 100;
    int m_value = 0;
    int m_lineWidth = 8;
};

// CircleProgress.cpp
#include "CircleProgress.h"
#include <QPainter>
#include <QConicalGradient>

CircleProgress::CircleProgress(QWidget *parent)
    : QWidget(parent)
{
    setMinimumSize(80, 80);
}

void CircleProgress::setValue(int value)
{
    m_value = qBound(m_min, value, m_max);
    update();
    emit valueChanged(m_value);
}

void CircleProgress::setRange(int min, int max)
{
    m_min = min;
    m_max = max;
    update();
}

void CircleProgress::setLineWidth(int width)
{
    m_lineWidth = width;
    update();
}

void CircleProgress::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);

    int side = qMin(width(), height());
    int offset = m_lineWidth / 2 + 4;
    QRectF arcRect(offset, offset, side - 2 * offset, side - 2 * offset);

    // 背景圆环
    p.setPen(QPen(QColor(220, 220, 220), m_lineWidth, Qt::SolidLine, Qt::RoundCap));
    p.drawArc(arcRect, 0, 360 * 16);

    // 前景进度
    double progress = double(m_value - m_min) / (m_max - m_min);
    int spanAngle = static_cast<int>(progress * 360 * 16);

    QConicalGradient gradient(arcRect.center(), 90);
    gradient.setColorAt(0.0, QColor(74, 144, 217));
    gradient.setColorAt(0.5, QColor(100, 200, 255));
    gradient.setColorAt(1.0, QColor(74, 144, 217));

    p.setPen(QPen(QBrush(gradient), m_lineWidth, Qt::SolidLine, Qt::RoundCap));
    p.drawArc(arcRect, 90 * 16, -spanAngle);

    // 中心文字
    p.setPen(QColor(50, 50, 50));
    p.setFont(QFont("Arial", 14, QFont::Bold));
    p.drawText(rect(), Qt::AlignCenter, QString("%1%").arg(int(progress * 100)));
}
```

### 11.2 自定义开关按钮

```cpp
// ToggleSwitch.h
class ToggleSwitch : public QWidget
{
    Q_OBJECT
public:
    explicit ToggleSwitch(QWidget *parent = nullptr);
    bool isOn() const { return m_on; }

public slots:
    void setOn(bool on);

signals:
    void toggled(bool on);

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    QSize sizeHint() const override;

private:
    bool m_on = false;
    QPropertyAnimation *m_animation = nullptr;
    qreal m_handlePos = 0.0;  // 0.0 ~ 1.0
};

// ToggleSwitch.cpp
ToggleSwitch::ToggleSwitch(QWidget *parent)
    : QWidget(parent)
{
    setFixedSize(60, 30);
    setCursor(Qt::PointingHandCursor);
    m_animation = new QPropertyAnimation(this, "handlePos", this);
    m_animation->setDuration(150);
}

void ToggleSwitch::setOn(bool on)
{
    m_on = on;
    m_animation->setStartValue(m_handlePos);
    m_animation->setEndValue(on ? 1.0 : 0.0);
    m_animation->start();
    emit toggled(m_on);
}

void ToggleSwitch::mousePressEvent(QMouseEvent *)
{
    setOn(!m_on);
}

void ToggleSwitch::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);

    int h = height();
    int trackW = width() - h / 2;
    int handleSize = h - 6;
    int handleX = 3 + m_handlePos * (width() - handleSize - 6);

    // 轨道
    QColor trackColor = m_on ? QColor(74, 144, 217) : QColor(200, 200, 200);
    p.setPen(Qt::NoPen);
    p.setBrush(trackColor);
    p.drawRoundedRect(3, 3, width() - 6, height() - 6, h / 2 - 3, h / 2 - 3);

    // 滑块
    p.setBrush(Qt::white);
    p.setPen(QPen(QColor(180, 180, 180), 1));
    p.drawEllipse(handleX, 3, handleSize, handleSize);
}

QSize ToggleSwitch::sizeHint() const
{
    return QSize(60, 30);
}
```

### 11.3 自定义控件注意事项

1. **重写 `sizeHint()`**：告诉布局系统首选大小
2. **重写 `minimumSizeHint()`**：告诉布局系统最小可接受大小
3. **调用 `update()` 刷新**：不要直接调用 `repaint()`
4. **使用 `Q_PROPERTY`**：支持动画和 QSS
5. **设置合适的 `focusPolicy`**：如果控件需要交互
6. **处理高 DPI**：使用 `devicePixelRatioF()` 做缩放

---

## 12. 性能优化

### 12.1 减少绘制区域

```cpp
// 只更新变化区域
void MyWidget::setValue(int v)
{
    if (m_value == v) return;
    int oldValue = m_value;
    m_value = v;
    // 只更新值显示区域
    update(valueRect());
}

QRect MyWidget::valueRect() const
{
    return QRect(width() - 80, 0, 80, height());
}
```

### 12.2 使用 QPixmap 缓存

```cpp
// 缓存复杂绘制结果
QPixmap cache;

void MyWidget::paintEvent(QPaintEvent *)
{
    if (cache.isNull()) {
        cache = QPixmap(size());
        cache.fill(Qt::transparent);
        QPainter cachePainter(&cache);
        renderComplexContent(cachePainter);
        cachePainter.end();
    }

    QPainter p(this);
    p.drawPixmap(0, 0, cache);
}

void MyWidget::resizeEvent(QResizeEvent *e)
{
    cache = QPixmap();  // 清除缓存
    QWidget::resizeEvent(e);
}
```

### 12.3 避免频繁创建 QPainter 对象

```cpp
// ❌ 不推荐
void MyWidget::paintEvent(QPaintEvent *)
{
    for (int i = 0; i < 1000; ++i) {
        QPainter p(this);   // 每次都创建/销毁 QPainter
        p.drawLine(...);
    }
}

// ✅ 推荐
void MyWidget::paintEvent(QPaintEvent *)
{
    QPainter p(this);       // 创建一次
    for (int i = 0; i < 1000; ++i) {
        p.drawLine(...);
    }
}
```

### 12.4 裁剪与脏矩形

```cpp
void MyWidget::paintEvent(QPaintEvent *event)
{
    QPainter p(this);
    // event->rect() 仅包含需要重绘的裁剪区域
    const QRect dirty = event->rect();
    p.setClipRect(dirty);

    // 只在 dirty 区域内绘制
    if (dirty.intersects(m_valueRect)) {
        drawValue(&p);
    }
}
```

### 12.5 其他优化技巧

- **禁用透明属性**：不需要时移除 `WA_TranslucentBackground`
- **禁用绘制**：静态控件设 `setAttribute(Qt::WA_OpaquePaintEvent)`
- **减少控件数量**：使用 `QWidget` + `QPainter` 代替大量子控件
- **使用 `QStaticText`**：静态文本缓存，比 `drawText` 快
- **合理设置更新频率**：动画使用 QTimer 控制帧率，不要用 `while` 循环

---

## 13. 常见陷阱与最佳实践

### 13.1 在 paintEvent 中创建 QPainter

```cpp
// ✅ 正确：使用 QPainter(this)
void MyWidget::paintEvent(QPaintEvent *)
{
    QPainter painter(this);
    // ...
}

// ❌ 错误：使用 QPainter 但没传入 this
void MyWidget::paintEvent(QPaintEvent *)
{
    QPainter painter;  // 默认构造，不生效！
    painter.begin(this);
    // ...
    painter.end();
}

// ❌ 错误：在 paintEvent 外绘制
void MyWidget::updateDisplay()
{
    QPainter painter(this);  // 运行时警告，绘制不生效
}
```

### 13.2 忘记调用父类事件

```cpp
// ✅ 正确：如果你需要保留父类行为
void MyWidget::resizeEvent(QResizeEvent *event)
{
    // 自定义处理
    adjustChildWidgets();
    QWidget::resizeEvent(event);  // 调用父类
}
```

### 13.3 内存管理

```cpp
// ✅ 正确：指定 parent，自动管理生命周期
auto *label = new QLabel("Hello", parentWidget);

// ✅ 正确：没有 parent 时手动管理
auto *dialog = new QDialog();
dialog->setAttribute(Qt::WA_DeleteOnClose);  // 关闭时自动删除

// ✅ 正确：在布局中设置
layout->addWidget(new QPushButton("OK"));  // 布局不负责内存，parent widget 负责
```

### 13.4 跨线程操作 UI

```cpp
// ❌ 错误：在非 GUI 线程操作 UI
void Worker::run()
{
    m_label->setText("Done");  // 崩溃或未定义行为
}

// ✅ 正确：使用信号槽跨线程
connect(worker, &Worker::finished, this, [this]() {
    m_label->setText("Done");
});

// ✅ 正确：使用 QMetaObject::invokeMethod
QMetaObject::invokeMethod(m_label, "setText",
    Qt::QueuedConnection, Q_ARG(QString, "Done"));

// ✅ 正确：QTimer::singleShot
QTimer::singleShot(0, m_label, [m_label]() {
    m_label->setText("Done");
});
```

### 13.5 样式表与性能

```cpp
// ❌ 性能差：全局通配选择器遍历所有控件
qApp->setStyleSheet("QWidget { font-size: 13px; }");

// ✅ 推荐：指定具体控件类型
qApp->setStyleSheet("* { font-size: 13px; }");

// ❌ 属性变化触发布局重算
widget->setStyleSheet("font-size: 13px;");
// ... 反复调用
widget->setStyleSheet("font-size: 14px;");  // 每次都会触发 recalc

// ✅ 推荐：尽量减少样式表动态变化
```

### 13.6 高 DPI 支持

```cpp
// main.cpp 中启用
int main(int argc, char *argv[])
{
    QApplication app(argc, argv);

#if QT_VERSION >= QT_VERSION_CHECK(5, 6, 0)
    app.setAttribute(Qt::AA_EnableHighDpiScaling);
#endif
#if QT_VERSION >= QT_VERSION_CHECK(6, 0, 0)
    // Qt6 默认启用高DPI，无需额外设置
#endif

    // 自定义绘制中使用 devicePixelRatio
    void MyWidget::paintEvent(QPaintEvent *)
    {
        QPainter p(this);
        qreal dpr = devicePixelRatioF();
        // 使用 dpr 缩放像素图等资源
    }
}
```

### 13.7 其他常见问题

| 问题 | 原因与解决 |
|------|-----------|
| `setStyleSheet` 不生效 | 检查选择器语法是否正确，确认 `Q_OBJECT` 宏已添加 |
| `update()` 后没有重绘 | 控件被隐藏、禁用或超出父控件可见区域 |
| 子控件位置异常 | 检查布局是否设置、边距和 spacing 是否正确 |
| 内存泄漏 | 未设置 parent 的 QWidget 需要手动 delete |
| 事件不响应 | 检查 `setEnabled`、`setVisible`、`eventFilter` 是否拦截 |
| QPainter 警告 | 确保只在 `paintEvent` 中使用 QPainter |
| 样式表卡顿 | 避免全局通配选择器 `*`，减少样式表嵌套深度 |

---

## 14. 总结

QWidget 是 Qt 界面编程的基石。掌握 QWidget 意味着掌握了 Qt UI 的核心：

- **事件系统**是 QWidget 交互能力的基础——理解事件流、事件过滤器和自定义事件能让你处理任何用户交互场景。
- **绘制系统**让 QWidget 能够呈现任意视觉内容——从最基本的几何图形到复杂的动画效果。
- **样式表**提供了声明式的外观定制能力——隔离 UI 逻辑与视觉设计。
- **布局管理**确保 UI 在不同窗口尺寸下都能正确排列——写 Qt 布局时始终使用布局管理器而非绝对定位。
- **父子关系与对象树**是 Qt 内存管理和 UI 层级组织的核心机制——善用 parent 可以避免大量内存管理问题。

### 学习路径建议

1. **入门**：掌握 QWidget 构造函数、父子关系、常用信号槽
2. **进阶**：理解事件系统、重写 paintEvent 自定义绘制
3. **深入**：掌握 QSS、布局嵌套、自定义控件封装
4. **精通**：研究 QGraphicsView 框架、QML 集成、GPU 加速绘制

### 推荐资源

- Qt 官方文档: https://doc.qt.io/qt-6/qwidget.html
- Qt 源码分析（qwidget.cpp 中的实现细节）
- 第三方控件库: Qt Material Widgets, QtnProperty, KDChart

