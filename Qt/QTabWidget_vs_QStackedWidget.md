# QTabWidget 与 QStackedWidget 的区别及常用方式

## 一、概述

`QTabWidget` 和 `QStackedWidget` 都是 Qt 中用于**管理多页面切换**的控件，但它们的设计定位和使用场景有显著区别。

| 特性 | QTabWidget | QStackedWidget |
|------|-----------|----------------|
| 内置导航 | 自带标签栏（Tab Bar） | 无内置导航 |
| 页面切换方式 | 点击标签切换 | 需通过代码 `setCurrentIndex()` 切换 |
| 独立性 | 独立控件，开箱即用 | 需配合其他控件（如 QListWidget）使用 |
| 灵活性 | 固定标签栏样式 | 可自定义任意切换方式 |
| 适用场景 | 设置对话框、分类浏览 | 向导流程、无标签界面 |

---

## 二、QTabWidget — 自带标签栏的多页容器

### 2.1 特点

- 顶部（或底部/左侧/右侧）自带 QTabBar
- 每个 Tab 对应一个页面（QWidget 子类）
- 点击 Tab 自动切换页面，无需额外代码

### 2.2 常用方式

```cpp
// 创建 TabWidget
QTabWidget *tabWidget = new QTabWidget(this);

// 创建页面
QWidget *page1 = new QWidget();
QWidget *page2 = new QWidget();

// 添加页面（传入 widget 和标题）
tabWidget->addTab(page1, "基本设置");
tabWidget->addTab(page2, "高级设置");

// 设置当前页
tabWidget->setCurrentIndex(0);

// 常用设置
tabWidget->setTabPosition(QTabWidget::North);   // 标签位置
tabWidget->setTabShape(QTabWidget::Rounded);     // 标签形状
tabWidget->setMovable(true);

// 信号与槽：标签切换
connect(tabWidget, &QTabWidget::currentChanged, [](int index) {
    qDebug() << "切换到第" << index << "页";
});
```

---

## 三、QStackedWidget — 无内置导航的页面堆栈

### 3.1 特点

- 不提供任何导航控件，只负责管理页面
- 一次只显示一个页面（当前页）
- 必须通过代码或其他控件控制切换

### 3.2 常用方式

```cpp
// 创建 StackedWidget
QStackedWidget *stackedWidget = new QStackedWidget(this);

// 创建页面
QWidget *page1 = new QWidget();
QWidget *page2 = new QWidget();
QWidget *page3 = new QWidget();

// 添加页面（返回 index）
int idx1 = stackedWidget->addWidget(page1);
int idx2 = stackedWidget->addWidget(page2);
int idx3 = stackedWidget->addWidget(page3);

// 切换页面
stackedWidget->setCurrentIndex(1);     // 按索引切换
stackedWidget->setCurrentWidget(page3); // 按指针切换

// 获取当前页面
int currentIdx = stackedWidget->currentIndex();
```

### 3.3 配合 QListWidget 实现导航

```cpp
// 左侧列表 + 右侧堆栈的经典布局
QListWidget *list = new QListWidget();
list->addItem("基本设置");
list->addItem("高级设置");
list->addItem("关于");

QStackedWidget *stack = new QStackedWidget();
stack->addWidget(new BasicSettingsPage());
stack->addWidget(new AdvancedSettingsPage());
stack->addWidget(new AboutPage());

// 连接信号
connect(list, &QListWidget::currentRowChanged,
        stack, &QStackedWidget::setCurrentIndex);
```

### 3.4 配合 QPushButton 实现向导流程

```cpp
// 上一步 / 下一步 向导
connect(btnNext, &QPushButton::clicked, [=]() {
    int next = stack->currentIndex() + 1;
    if (next < stack->count()) {
        stack->setCurrentIndex(next);
    }
});

connect(btnPrev, &QPushButton::clicked, [=]() {
    int prev = stack->currentIndex() - 1;
    if (prev >= 0) {
        stack->setCurrentIndex(prev);
    }
});
```

---

## 四、核心区别总结

| 对比维度 | QTabWidget | QStackedWidget |
|---------|-----------|----------------|
| 内置 Tab 栏 | 有 | 无 |
| 实现代码量 | 少（开箱即用） | 多（需自行实现导航） |
| 切换方式 | 点击 Tab | `setCurrentIndex()` / `setCurrentWidget()` |
| 自定义导航 | 受限（可隐藏 Tab 栏） | 完全灵活 |
| 典型场景 | 偏好设置、分类浏览 | 安装向导、多步表单 |
| 灵活性 | 低（样式固定） | 高（完全可控） |

### 如何选择？

- **需要标准标签切换 → QTabWidget**（简单快速）
- **需要自定义切换方式 → QStackedWidget**（如列表导航、按钮翻页）
- **需要向导/步骤流程 → QStackedWidget**（搭配按钮更自然）
- **既有标签又想自定义 →** 用 QTabWidget 隐藏 TabBar + 代码控制切换

---

## 五、完整示例：左侧列表 + 右侧堆栈

```cpp
#include <QApplication>
#include <QHBoxLayout>
#include <QListWidget>
#include <QStackedWidget>
#include <QLabel>

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);

    QWidget window;
    QHBoxLayout *layout = new QHBoxLayout(&window);

    // 左侧导航
    QListWidget *list = new QListWidget();
    list->addItem("页面一");
    list->addItem("页面二");
    list->addItem("页面三");
    list->setFixedWidth(120);

    // 右侧页面
    QStackedWidget *stack = new QStackedWidget();
    stack->addWidget(new QLabel("这是页面一的内容"));
    stack->addWidget(new QLabel("这是页面二的内容"));
    stack->addWidget(new QLabel("这是页面三的内容"));

    layout->addWidget(list);
    layout->addWidget(stack, 1);

    connect(list, &QListWidget::currentRowChanged,
            stack, &QStackedWidget::setCurrentIndex);

    window.resize(600, 400);
    window.show();
    return app.exec();
}
```
