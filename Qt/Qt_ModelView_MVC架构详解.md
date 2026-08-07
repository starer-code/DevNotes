# Qt Model/View 架构详解 — Item Model 体系

## 一、架构总览

Qt 的 Model/View 架构是对经典 MVC 模式的实现与改造：

| 层级 | 职责 | 对应类 |
|------|------|--------|
| **Model**（数据源） | 存储数据、提供数据访问接口 | QAbstractItemModel 系列 |
| **View**（视图） | 显示数据、处理用户交互 | QTableView, QTreeView, QListView |
| **Delegate**（委托） | 自定义渲染和编辑 | QStyledItemDelegate |

**核心思想**：数据（Model）与展示（View）完全解耦，同一个 Model 可以同时被多个 View 显示。

---

## 二、类继承体系

```
QObject
  └── QAbstractItemModel            ← 所有 Item Model 的根基类
        ├── QAbstractListModel      ← 简单一维列表的抽象基类
        │     └── QStringListModel
        ├── QAbstractTableModel     ← 二维表格的抽象基类
        │     └── QSqlTableModel / QSqlQueryModel
        └── QStandardItemModel       ← 开箱即用的通用模型（树/表/列表通吃）
```

其他直接从 QAbstractItemModel 派生的专用模型：
- **QFileSystemModel** — 文件系统树
- **QSqlRelationalTableModel** — 带关联的数据库表模型


---

## 三、核心索引系统：QModelIndex

Model/View 的通信枢纽是 **QModelIndex**（模型索引）。

```cpp
// ===== 简化示意（非真实可编译代码） =====
// QModelIndex 实际是只读值类型，不能直接 new 或构造
// 必须通过 model->index(row, col, parent) 获得
class QModelIndex {
    int row();       // 行号
    int column();    // 列号
    QModelIndex parent();  // 父索引（树形结构用）
    QVariant data(int role = Qt::DisplayRole);  // 按角色取数据
    QAbstractItemModel *model();  // 所属模型
};
```

**三种特殊索引：**

| 索引 | 含义 |
|------|------|
| `QModelIndex()` | 无效索引，表示根节点（所有顶层元素的父索引） |
| `QPersistentModelIndex` | 持久索引，会随 Model 插入/删除自动更新位置 |
| `createIndex(row, col, ptr)` | Model 内部用来创建索引的工厂方法（仅在自定义 Model 内部调用） |

### 角色（Role）机制

Model 中的每个数据项可以携带多种"角色"的数据：

```cpp
// 常用角色
Qt::DisplayRole        // 显示文本（最常用）
Qt::DecorationRole    // 图标/颜色（QPixmap / QColor）
Qt::ToolTipRole       // 工具提示
Qt::FontRole          // 字体（QFont）
Qt::TextAlignmentRole // 对齐方式（Qt::Alignment）
Qt::BackgroundRole    // 背景色（QBrush）
Qt::ForegroundRole    // 前景色（QBrush）
Qt::CheckStateRole    // 复选框状态（Qt::CheckState）
Qt::SizeHintRole      // 尺寸建议（QSize）
```

> 通过自定义 Role（从 `Qt::UserRole` 开始），可以给数据项附加任意自定义数据。


---

## 四、QAbstractItemModel — 一切的基础

QAbstractItemModel 是所有 Item Model 的抽象基类。自定义 Model 时必须重写以下**纯虚函数**：

### 4.1 必须重写的函数

```cpp
class MyModel : public QAbstractItemModel {
public:
    // 返回指定索引下的数据
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;

    // 返回指定索引的行数（顶层：无 parent；子节点：parent 对应的子行数）
    int rowCount(const QModelIndex &parent = QModelIndex()) const override;

    // 返回指定索引的列数（大多数场景返回 1 或固定列数）
    int columnCount(const QModelIndex &parent = QModelIndex()) const override;

    // 为子项创建索引（核心！）
    QModelIndex index(int row, int column, const QModelIndex &parent = QModelIndex()) const override;

    // 返回指定索引的父索引
    QModelIndex parent(const QModelIndex &index) const override;
};
```

### 4.2 可选重写的函数

```cpp
    // 表头数据（第 0 行水平表头、第 0 列垂直表头）
    QVariant headerData(int section, Qt::Orientation orientation, int role) const override;

    // 是否有子项（优化：叶节点返回 false 可避免展开时的无用查询）
    bool hasChildren(const QModelIndex &parent = QModelIndex()) const override;
```

### 4.3 修改数据（可编辑模型需重写）

```cpp
    // 设置数据，返回是否成功
    bool setData(const QModelIndex &index, const QVariant &value, int role = Qt::EditRole) override;

    // 返回索引的标志（可选中、可编辑等）
    Qt::ItemFlags flags(const QModelIndex &index) const override;

    // 插入/删除行
    bool insertRows(int row, int count, const QModelIndex &parent = QModelIndex()) override;
    bool removeRows(int row, int count, const QModelIndex &parent = QModelIndex()) override;
```

### 4.4 通知视图的关键信号

修改数据后，**必须**通知 View 刷新，否则显示不同步：

```cpp
    // 数据变化（Qt 5.12+ 支持第三个参数 roles 列表）
    emit dataChanged(topLeft, bottomRight, {role});

    // 结构变化前（插入/删除/重排前调用）
    beginInsertRows(parent, first, last);
    // ... 执行插入 ...
    endInsertRows();

    beginRemoveRows(parent, first, last);
    // ... 执行删除 ...
    endRemoveRows();

    // 整个模型重置
    beginResetModel();
    // ... 重建数据 ...
    endResetModel();
```

> ⚠️ **常见错误**：修改数据后忘记调用 `dataChanged`，导致 View 不刷新。调试时优先检查这一点。


---

## 五、QAbstractListModel — 一维列表

继承自 QAbstractItemModel，**自动处理了 row/column/parent/index 的逻辑**，开发者只需关注"数据在哪"。

### 5.1 必须重写的函数

```cpp
class StringList : public QAbstractListModel {
public:
    int rowCount(const QModelIndex &parent = QModelIndex()) const override {
        return parent.isValid() ? 0 : m_strings.size();  // 树形子项为空
    }

    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override {
        if (!index.isValid()) return QVariant();
        if (role == Qt::DisplayRole || role == Qt::EditRole)
            return m_strings.at(index.row());
        return QVariant();
    }

private:
    QStringList m_strings;
};
```

### 5.2 特点

| 特性 | 说明 |
|------|------|
| 单列 | 只有一列，`columnCount()` 固定返回 0（或 1） |
| 无树形 | `parent()` 始终返回无效索引 |
| 适合场景 | QListView、QComboBox、QStringListModel 不能满足时 |
| 简化之处 | 不需要实现 `index()`、`parent()`、`columnCount()` |

---

## 六、QAbstractTableModel — 二维表格

同理，自动处理行列索引逻辑，开发者专注于二维网格数据。

### 6.1 必须重写的函数

```cpp
class TableModel : public QAbstractTableModel {
public:
    int rowCount(const QModelIndex &parent = QModelIndex()) const override {
        return parent.isValid() ? 0 : m_data.size();
    }

    int columnCount(const QModelIndex &parent = QModelIndex()) const override {
        return parent.isValid() ? 0 : m_headers.size();
    }

    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override {
        if (!index.isValid()) return QVariant();
        if (role == Qt::DisplayRole || role == Qt::EditRole)
            return m_data[index.row()][index.column()];
        if (role == Qt::TextAlignmentRole && index.column() == 2)
            return Qt::AlignRight;
        return QVariant();
    }

    QVariant headerData(int section, Qt::Orientation orientation, int role) const override {
        if (role != Qt::DisplayRole) return QVariant();
        if (orientation == Qt::Horizontal)
            return m_headers.at(section);
        return section + 1;  // 垂直表头显示行号
    }

private:
    QList<QList<QVariant>> m_data;
    QStringList m_headers;
};
```

### 6.2 对比 QAbstractListModel

| 特性 | QAbstractListModel | QAbstractTableModel |
|------|-------------------|---------------------|
| 维度 | 单列列表 | 多列表格 |
| 必须实现 | `rowCount` + `data` | `rowCount` + `columnCount` + `data` |
| 表头 | 通常不需要 | 通常需要 `headerData` |
| 典型搭配 | QListView, QComboBox | QTableView |
| 需要 index/parent 吗 | 不需要 | **不需要**（表格是扁平结构，基类默认实现即可） |


---

## 七、QStandardItemModel — 开箱即用的通用模型

QStandardItemModel 是 Qt 提供的**最便捷的 Model 实现**，无需继承，直接使用。它内部用 `QStandardItem` 树形结构存储数据，支持列表、表格、树形三种视图。

### 7.1 核心类：QStandardItem

```cpp
QStandardItem *item = new QStandardItem("Hello");
item->setData("World", Qt::ToolTipRole);   // 设置工具提示
item->setCheckable(true);                   // 启用复选框
item->setForeground(Qt::blue);              // 前景色
item->setEditable(false);                    // 禁止编辑
```

**每个 QStandardItem 就是一个树节点**，拥有自己的子节点列表和 parent 指针。

### 7.2 基本使用示例

```cpp
// ===== 作为表格模型 =====
QStandardItemModel *model = new QStandardItemModel(4, 2);  // 4行2列
model->setHorizontalHeaderLabels({"姓名", "成绩"});

for (int row = 0; row < 4; ++row) {
    QStandardItem *name = new QStandardItem(QString("学生%1").arg(row + 1));
    QStandardItem *score = new QStandardItem(QString::number(80 + row * 5));
    score->setTextAlignment(Qt::AlignCenter);
    model->setItem(row, 0, name);
    model->setItem(row, 1, score);
}

QTableView *view = new QTableView;
view->setModel(model);
view->show();
```

```cpp
// ===== 作为树形模型 =====
QStandardItemModel *treeModel = new QStandardItemModel;
QStandardItem *root = treeModel->invisibleRootItem();  // 隐形根节点

// 一级节点
QStandardItem *parentItem = new QStandardItem("数学");
root->appendRow(parentItem);

// 二级节点（子节点）
parentItem->appendRow(new QStandardItem("代数"));
parentItem->appendRow(new QStandardItem("几何"));
parentItem->appendRow(new QStandardItem("微积分"));

QTreeView *tree = new QTreeView;
tree->setModel(treeModel);
tree->expandAll();
```

```cpp
// ===== 作为列表模型 =====
QStandardItemModel *listModel = new QStandardItemModel;
QStringList items = {"苹果", "香蕉", "橙子", "葡萄"};
for (const QString &s : items) {
    QStandardItem *item = new QStandardItem(s);
    item->setIcon(QIcon(":/icons/fruit.png"));
    listModel->appendRow(item);
}

QListView *listView = new QListView;
listView->setModel(listModel);
```

### 7.3 常用操作速查

| 操作 | 方法 |
|------|------|
| 获取 item | `item(row, col)` / `itemFromIndex(index)` |
| 插入行 | `insertRow(row, items)` / `appendRow(item)` |
| 删除行 | `removeRow(row)` / `removeRows(row, count)` |
| 交换行 | `swapRows(a, b)` (Qt 5.13+) |
| 查找 | `findItems(text)` |
| 排序 | `sort(column, order)` |
| 隐藏列 | `setColumnHidden(col, true)` (在 View 上调用) |
| 拖拽支持 | `item->setDragEnabled(true)` + `item->setDropEnabled(true)` |

### 7.4 优缺点

| 优点 | 缺点 |
|------|------|
| 零代码快速原型 | 数据全部驻留内存，大数据集不适用 |
| 树/表/列表通用 | 不支持懒加载 |
| 内置排序、拖拽、编辑 | 不适合对接数据库或文件系统 |
| API 简洁直观 | 自定义能力有限 |

---

## 八、View 组件一览

| View | 用途 | 搭配的 Model |
|------|------|-------------|
| `QListView` | 单列列表 | QAbstractListModel / QStandardItemModel |
| `QTableView` | 二维表格 | QAbstractTableModel / QStandardItemModel |
| `QTreeView` | 树形展开 | QAbstractItemModel / QStandardItemModel / QFileSystemModel |
| `QColumnView` | 多列级联（macOS Finder 风格） | QAbstractItemModel |
| `QComboBox` | 下拉选择框 | QAbstractListModel |
| `QHeaderView` | 表格/树的行列表头 | 随 View 自动创建 |

### 常用 View 配置

```cpp
// 交替行颜色
view->setAlternatingRowColors(true);

// 选择行为
view->setSelectionMode(QAbstractItemView::SingleSelection);
view->setSelectionBehavior(QAbstractItemView::SelectRows);

// 禁止编辑
view->setEditTriggers(QAbstractItemView::NoEditTriggers);

// 自适应列宽
view->horizontalHeader()->setStretchLastSection(true);
view->resizeColumnsToContents();

// 冻结首列（QTableView）
view->setFrozen(0, true);  // Qt 6.2+
```


---

## 九、QSortFilterProxyModel — 代理模型（过滤/排序）

代理模型拦截 Model 与 View 之间的数据流，实现排序、过滤、映射，而**不修改原始数据**。

```cpp
// 基本用法
QSortFilterProxyModel *proxy = new QSortFilterProxyModel;
proxy->setSourceModel(model);  // 设置原始模型

// 过滤：只显示包含"张"的行
proxy->setFilterKeyColumn(-1);  // 所有列
proxy->setFilterRegularExpression(QRegularExpression("张"));

// 排序
proxy->sort(1, Qt::DescendingOrder);  // 按第 1 列降序

// View 使用代理模型（不是原始模型）
view->setModel(proxy);
```

### 关键 API

| 方法 | 说明 |
|------|------|
| `setFilterFixedString()` | 精确匹配过滤 |
| `setFilterRegularExpression()` | 正则过滤 |
| `setFilterCallback()` (Qt 6) | 自定义 lambda 过滤 |
| `sort(column, order)` | 排序 |
| `mapToSource()` | View 索引 → 原始 Model 索引 |
| `mapFromSource()` | 原始 Model 索引 → View 索引 |

> ⚠️ 使用代理模型时，View 上的行号与原始 Model 不同！通过 View 获取索引后，需要 `mapToSource()` 转换回原始 Model。

---

## 十、Delegate（委托）

Delegate 控制数据的**渲染**和**编辑**。

### QStyledItemDelegate vs QItemDelegate

| 特性 | QStyledItemDelegate | QItemDelegate |
|------|-------------------|---------------|
| 继承关系 | QAbstractItemDelegate | QAbstractItemDelegate |
| 绘制方式 | 使用 **QStyle** 绘制 | 自己绘制，不走 Style |
| 支持 StyleSheet | ✅ 是 | ❌ 否 |
| 推荐程度 | **Qt 官方推荐** | 仅用于兼容 Qt4 旧代码 |
| 使用场景 | 99% 的情况都用这个 | 几乎不用 |

> **结论**：永远用 `QStyledItemDelegate`，除非你在维护一个从 Qt4 迁移过来的老项目。

### 默认行为

Qt 为每种 View 提供默认的 `QStyledItemDelegate`，通常够用。需要自定义时：

```cpp
// 自定义委托示例：星级评分编辑器
class StarDelegate : public QStyledItemDelegate {
public:
    using QStyledItemDelegate::QStyledItemDelegate;

    // 自定义渲染
    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override {
        int rating = index.data().toInt();
        // 绘制星星...
    }

    // 自定义编辑器
    QWidget *createEditor(QWidget *parent, const QStyleOptionViewItem &option,
                          const QModelIndex &index) const override {
        QSpinBox *editor = new QSpinBox(parent);
        editor->setRange(1, 5);
        return editor;
    }

    // 编辑器 → Model 数据
    void setEditorData(QWidget *editor, const QModelIndex &index) const override {
        static_cast<QSpinBox*>(editor)->setValue(index.data().toInt());
    }

    // Model 数据 → 编辑器
    void setModelData(QWidget *editor, QAbstractItemModel *model,
                      const QModelIndex &index) const override {
        int val = static_cast<QSpinBox*>(editor)->value();
        model->setData(index, val);
    }
};

// 使用
view->setItemDelegateForColumn(2, new StarDelegate);
```


---

## 十一、完整实战：自定义 QAbstractTableModel

以下是一个完整的通讯录 Model 示例，串联所有知识点：

> **注意**：表格模型是**扁平结构**，不需要实现 `index()` 和 `parent()`——QAbstractTableModel 的基类默认实现已经够了。

```cpp
// === contactmodel.h ===
struct Contact {
    QString name;
    QString phone;
    bool favorite;
};

class ContactModel : public QAbstractTableModel {
    Q_OBJECT
public:
    enum Roles {
        NameRole = Qt::UserRole + 1,
        PhoneRole,
        FavoriteRole
    };

    explicit ContactModel(QObject *parent = nullptr);

    // 必须重写（只需这三个）
    int rowCount(const QModelIndex &parent) const override;
    int columnCount(const QModelIndex &parent) const override;
    QVariant data(const QModelIndex &index, int role) const override;

    // 可选重写
    QVariant headerData(int section, Qt::Orientation orient, int role) const override;
    Qt::ItemFlags flags(const QModelIndex &index) const override;
    bool setData(const QModelIndex &index, const QVariant &value, int role) override;

    // 公开方法
    void addContact(const QString &name, const QString &phone);
    void removeContact(int row);

private:
    QList<Contact> m_contacts;
};
```

```cpp
// === contactmodel.cpp ===
ContactModel::ContactModel(QObject *parent)
    : QAbstractTableModel(parent) {}

int ContactModel::rowCount(const QModelIndex &parent) const {
    return parent.isValid() ? 0 : m_contacts.size();
}

int ContactModel::columnCount(const QModelIndex &parent) const {
    return parent.isValid() ? 0 : 3;  // 姓名、电话、收藏
}

QVariant ContactModel::data(const QModelIndex &index, int role) const {
    if (!index.isValid() || index.row() >= m_contacts.size())
        return QVariant();

    const Contact &c = m_contacts[index.row()];

    if (role == Qt::DisplayRole || role == Qt::EditRole) {
        switch (index.column()) {
        case 0: return c.name;
        case 1: return c.phone;
        case 2: return c.favorite ? "★" : "☆";
        }
    }
    if (role == Qt::DecorationRole && index.column() == 0)
        return QIcon(":/icons/contact.png");
    if (role == Qt::CheckStateRole && index.column() == 2)
        return c.favorite ? Qt::Checked : Qt::Unchecked;

    return QVariant();
}

QVariant ContactModel::headerData(int section, Qt::Orientation orient, int role) const {
    if (role != Qt::DisplayRole || orient != Qt::Horizontal)
        return QVariant();
    switch (section) {
    case 0: return "姓名";
    case 1: return "电话";
    case 2: return "收藏";
    }
    return QVariant();
}

Qt::ItemFlags ContactModel::flags(const QModelIndex &index) const {
    Qt::ItemFlags f = Qt::ItemIsEnabled | Qt::ItemIsSelectable;
    if (index.column() < 2)
        f |= Qt::ItemIsEditable;
    if (index.column() == 2)
        f |= Qt::ItemIsUserCheckable;
    return f;
}

bool ContactModel::setData(const QModelIndex &index, const QVariant &value, int role) {
    if (!index.isValid() || index.row() >= m_contacts.size())
        return false;

    Contact &c = m_contacts[index.row()];

    if (role == Qt::EditRole) {
        switch (index.column()) {
        case 0: c.name = value.toString(); break;
        case 1: c.phone = value.toString(); break;
        default: return false;
        }
    } else if (role == Qt::CheckStateRole && index.column() == 2) {
        c.favorite = (value.toInt() == Qt::Checked);
    } else {
        return false;
    }

    emit dataChanged(index, index, {role});
    return true;
}

void ContactModel::addContact(const QString &name, const QString &phone) {
    beginInsertRows(QModelIndex(), m_contacts.size(), m_contacts.size());
    m_contacts.append({name, phone, false});
    endInsertRows();
}

void ContactModel::removeContact(int row) {
    if (row < 0 || row >= m_contacts.size()) return;
    beginRemoveRows(QModelIndex(), row, row);
    m_contacts.removeAt(row);
    endRemoveRows();
}
```


---

## 十二、完整实战：自定义树形 QAbstractItemModel（重点）

树形 Model 的 `index()` 和 `parent()` 是整个体系中**最核心也最难理解**的部分。以下是通用实现模板。

### 12.1 数据结构设计

关键：每个节点需要知道自己的**父节点**和**子节点列表**。

```cpp
// 树节点基类
struct TreeNode {
    QString name;
    TreeNode *parent = nullptr;
    QList<TreeNode*> children;

    ~TreeNode() { qDeleteAll(children); }

    void appendChild(TreeNode *child) {
        child->parent = this;
        children.append(child);
    }

    TreeNode *childAt(int row) const {
        return (row >= 0 && row < children.size()) ? children.at(row) : nullptr;
    }

    int childCount() const { return children.size(); }

    int row() const {
        // 计算自己在父节点的子节点列表中的行号
        if (!parent) return 0;
        return parent->children.indexOf(const_cast<TreeNode*>(this));
    }
};
```

> ⚠️ **`row()` 方法是关键**：QAbstractItemModel 的 `parent()` 需要知道子节点在父节点中的行号，而这个信息不会自动保存，必须由节点自己计算。

### 12.2 index() 实现

`index()` 的职责：**给定 (row, col, parent)，创建一个指向该位置子节点的索引**。

```cpp
QModelIndex TreeModel::index(int row, int column, const QModelIndex &parent) const {
    if (!hasIndex(row, column, parent))
        return QModelIndex();

    TreeNode *parentNode = parent.isValid()
        ? static_cast<TreeNode*>(parent.internalPointer())
        : m_root;

    TreeNode *childNode = parentNode->childAt(row);
    if (!childNode)
        return QModelIndex();

    return createIndex(row, column, childNode);  // internalPointer 指向节点
}
```

### 12.3 parent() 实现

`parent()` 的职责：**给定一个索引，返回其父节点的索引**（反向查找）。

```cpp
QModelIndex TreeModel::parent(const QModelIndex &index) const {
    if (!index.isValid())
        return QModelIndex();

    TreeNode *childNode = static_cast<TreeNode*>(index.internalPointer());
    TreeNode *parentNode = childNode->parent;

    if (parentNode == m_root || !parentNode)
        return QModelIndex();  // 顶层节点的父是无效索引

    return createIndex(parentNode->row(), 0, parentNode);
}
```

### 12.4 完整树形 Model 框架

```cpp
// === treemodel.h ===
class TreeModel : public QAbstractItemModel {
    Q_OBJECT
public:
    explicit TreeModel(QObject *parent = nullptr);
    ~TreeModel();

    QModelIndex index(int row, int column, const QModelIndex &parent) const override;
    QModelIndex parent(const QModelIndex &index) const override;
    int rowCount(const QModelIndex &parent) const override;
    int columnCount(const QModelIndex &parent) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QVariant headerData(int section, Qt::Orientation orient, int role) const override;

private:
    TreeNode *m_root;
};
```

```cpp
// === treemodel.cpp ===
TreeModel::TreeModel(QObject *parent)
    : QAbstractItemModel(parent)
    , m_root(new TreeNode{"Root", nullptr, {}}) {
    // 构造树结构
    auto *math = new TreeNode{"数学", m_root, {}};
    m_root->appendChild(math);
    math->appendChild(new TreeNode{"代数", math, {}});
    math->appendChild(new TreeNode{"几何", math, {}});

    auto *cs = new TreeNode{"计算机", m_root, {}};
    m_root->appendChild(cs);
    cs->appendChild(new TreeNode{"数据结构", cs, {}});
    cs->appendChild(new TreeNode{"操作系统", cs, {}});
}

TreeModel::~TreeModel() { delete m_root; }

// ===== 核心四件套 =====

QModelIndex TreeModel::index(int row, int col, const QModelIndex &parent) const {
    if (!hasIndex(row, col, parent))
        return QModelIndex();
    TreeNode *p = parent.isValid()
        ? static_cast<TreeNode*>(parent.internalPointer()) : m_root;
    TreeNode *child = p->childAt(row);
    return child ? createIndex(row, col, child) : QModelIndex();
}

QModelIndex TreeModel::parent(const QModelIndex &index) const {
    if (!index.isValid()) return QModelIndex();
    TreeNode *child = static_cast<TreeNode*>(index.internalPointer());
    TreeNode *par = child->parent;
    if (!par || par == m_root) return QModelIndex();
    return createIndex(par->row(), 0, par);
}

int TreeModel::rowCount(const QModelIndex &parent) const {
    TreeNode *node = parent.isValid()
        ? static_cast<TreeNode*>(parent.internalPointer()) : m_root;
    return node->childCount();
}

int TreeModel::columnCount(const QModelIndex &) const {
    return 1;  // 单列树
}

// ===== 数据 =====

QVariant TreeModel::data(const QModelIndex &index, int role) const {
    if (!index.isValid() || role != Qt::DisplayRole)
        return QVariant();
    TreeNode *node = static_cast<TreeNode*>(index.internalPointer());
    return node->name;
}

QVariant TreeModel::headerData(int section, Qt::Orientation, int role) const {
    return (role == Qt::DisplayRole) ? "名称" : QVariant();
}
```

### 12.5 index/parent 心智模型

用一个口诀来理解：

```
index(row, col, parent)  →  从 parent 出发，找第 row 个孩子，给它建索引
parent(index)            →  从 index 出发，找它爹，给爹建索引
```

两个方向的共同点：都需要通过 `internalPointer()` 存取节点指针。


---

## 十三、拖拽（Drag & Drop）

Model/View 的拖拽涉及两个角色：
- **Drag**：从哪里取数据
- **Drop**：把数据放到哪里

### 13.1 启用拖拽

```cpp
// View 端
view->setDragEnabled(true);
view->setAcceptDrops(true);
view->setDropIndicatorShown(true);
view->setDragDropMode(QAbstractItemView::InternalMove);  // 内部移动（最常用）

// Model 端（如果用 QStandardItemModel，item 默认支持拖拽）
// 自定义 Model 则需要重写以下函数：
```

### 13.2 自定义 Model 拖拽需要重写的函数

```cpp
// Drag 端：把数据打包成 MIME
Qt::ItemFlags flags(const QModelIndex &index) const override;
Qt::MimeData *mimeData(const QModelIndexList &indexes) const override;
QStringList mimeTypes() const override;

// Drop 端：从 MIME 解包数据
bool dropMimeData(const QMimeData *data, Qt::DropAction action,
                  int row, int column, const QModelIndex &parent) override;

// 优化：只允许特定节点作为 drop 目标
bool canDropMimeData(const QMimeData *data, Qt::DropAction action,
                     int row, int column, const QModelIndex &parent) const override;
```

### 13.3 常见配置组合

| 模式 | 枚举值 | 场景 |
|------|--------|------|
| `InternalMove` | QAbstractItemView::InternalMove | 树内拖拽重排（最常用） |
| `DragDrop` | QAbstractItemView::DragDrop | 跨 Model 拖拽 |
| `DragOnly` | QAbstractItemView::DragOnly | 只能拖，不能放 |
| `DropOnly` | QAbstractItemView::DropOnly | 只能放，不能拖 |
| `NoDragDrop` | QAbstractItemView::NoDragDrop | 禁用拖拽 |

---

## 十四、选型决策树

```
需要自定义 Model 吗？
│
├── 数据量小，仅做展示 → QStandardItemModel 直接用
│
├── 一维列表
│   ├── 简单字符串列表 → QStringListModel
│   └── 自定义数据 → 继承 QAbstractListModel
│
├── 二维表格
│   ├── 数据来自数据库 → QSqlTableModel
│   └── 其他来源 → 继承 QAbstractTableModel
│
├── 树形结构
│   ├── 文件系统 → QFileSystemModel
│   ├── 数据来自数据库 → QSqlRelationalTableModel（带展开）
│   └── 其他 → 继承 QAbstractItemModel（需实现 index/parent）
│
└── 需要过滤/排序 → 包一层 QSortFilterProxyModel
```

---

## 十五、常见坑与调试技巧

### 15.1 View 不刷新

```cpp
// ✗ 忘记通知
m_data[row] = newVal;

// ✓ 修改后必须通知
m_data[row] = newVal;
emit dataChanged(index(row, 0), index(row, columnCount() - 1));
```

### 15.2 插入/删除后崩溃

```cpp
// ✗ 直接操作数据
m_data.append(item);

// ✓ 必须用 begin/end 包裹
beginInsertRows(QModelIndex(), m_data.size(), m_data.size());
m_data.append(item);
endInsertRows();
```

### 15.3 树形结构的 index() 和 parent() 写错

这是自定义树形 Model **最常崩溃的地方**，常见症状：
- 展开节点后程序崩溃（`index()` 返回了空索引）
- 节点折叠后无法展开（`parent()` 返回了错误索引）

**调试方法**：
1. 在 `index()` 和 `parent()` 中加 `qDebug()` 输出参数和返回值
2. 检查 `internalPointer()` 转型是否正确（节点类型是否匹配）
3. 检查节点的 `row()` 方法是否正确返回了在父节点中的索引
4. 用 `QStandardItemModel` 构建同样的树结构对比，确认逻辑一致

### 15.4 代理模型的索引错位

```cpp
// ✗ 直接用 View 的索引操作 Model
model->data(view->currentIndex());

// ✓ 通过代理转换
QModelIndex sourceIndex = proxy->mapToSource(view->currentIndex());
model->data(sourceIndex);
```

### 15.5 QAbstractTableModel 不需要实现 index/parent

```cpp
// ✗ 很多教程的错误写法：给表格模型写了 index() 和 parent()
QModelIndex TableModel::parent(const QModelIndex &) const {
    return QModelIndex();  // 多余！基类默认就是这个行为
}

// ✓ 表格模型只写：rowCount / columnCount / data / headerData
```

---

## 十六、信号槽连接汇总

```cpp
// View 选择变化 → 槽函数
connect(view->selectionModel(), &QItemSelectionModel::currentChanged,
    [](const QModelIndex &current, const QModelIndex &previous) {
        qDebug() << "选中:" << current.data().toString();
    });

// Model 数据变化 → 刷新其他视图（通常自动处理）
connect(model, &QAbstractItemModel::dataChanged,
    [](const QModelIndex &topLeft, const QModelIndex &bottomRight) {
        qDebug() << "数据变化:" << topLeft << "→" << bottomRight;
    });

// Model 结构变化 → 刷新视图（通常自动处理）
connect(model, &QAbstractItemModel::rowsInserted,
    [](const QModelIndex &parent, int first, int last) {
        qDebug() << "插入行:" << first << "到" << last;
    });

// 双击编辑
connect(view, &QAbstractItemView::doubleClicked,
    [](const QModelIndex &index) {
        qDebug() << "双击:" << index.data().toString();
    });
```
