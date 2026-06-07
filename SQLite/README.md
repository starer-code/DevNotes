# SQLite 学习笔记

## 目录

- [基础语法](#基础语法)
- [数据类型](#数据类型)
- [约束](#约束)
- [索引](#索引)
- [Qt 中的 SQLite](#qt-中的-sqlite)

---

## 基础语法

### 增删改查

```sql
-- 创建表
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    age INTEGER
);

-- 插入数据
INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@example.com', 25);

-- 查询数据
SELECT * FROM users WHERE age > 20;

-- 更新数据
UPDATE users SET age = 26 WHERE name = 'Alice';

-- 删除数据
DELETE FROM users WHERE id = 1;
```

### 聚合函数

```sql
-- 计数
SELECT COUNT(*) FROM users;

-- 求和
SELECT SUM(age) FROM users;

-- 平均值
SELECT AVG(age) FROM users;

-- 分组统计
SELECT age, COUNT(*) FROM users GROUP BY age;
```

---

## 数据类型

| 类型 | 说明 |
|---|---|
| INTEGER | 整数 |
| REAL | 浮点数 |
| TEXT | 文本字符串 |
| BLOB | 二进制数据 |
| NULL | 空值 |

---

## 约束

| 约束 | 说明 |
|---|---|
| PRIMARY KEY | 主键 |
| NOT NULL | 非空 |
| UNIQUE | 唯一 |
| DEFAULT | 默认值 |
| CHECK | 检查条件 |
| FOREIGN KEY | 外键 |

---

## 索引

```sql
-- 创建索引
CREATE INDEX idx_email ON users(email);

-- 复合索引
CREATE INDEX idx_name_age ON users(name, age);
```

---

## Qt 中的 SQLite

### 基本使用

```cpp
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>

// 打开数据库
QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE");
db.setDatabaseName("app.db");
if (!db.open()) {
    qDebug() << "数据库打开失败:" << db.lastError().text();
}

// 执行查询
QSqlQuery query;
query.prepare("INSERT INTO users (name, age) VALUES (?, ?)");
query.addBindValue("Alice");
query.addBindValue(25);
if (!query.exec()) {
    qDebug() << "插入失败:" << query.lastError().text();
}
```

### 事务处理

```cpp
QSqlDatabase db = QSqlDatabase::database();
db.transaction();

QSqlQuery query(db);
query.exec("INSERT INTO users (name) VALUES ('Bob')");
query.exec("INSERT INTO users (name) VALUES ('Charlie')");

if (!db.commit()) {
    db.rollback();  // 失败回滚
}
```

---

## 常见问题

### Q: SQLite 和 MySQL 的区别？

**A:**
- **SQLite**：嵌入式、无服务器、轻量级
- **MySQL**：客户端/服务器、多用户、功能更丰富

### Q: 什么时候用索引？

**A:**
- 频繁查询的字段
- 外键字段
- 不要在频繁更新的字段上建索引
