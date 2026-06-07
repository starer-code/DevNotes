# Git 学习笔记

## 目录

- [基础命令](#基础命令)
- [分支管理](#分支管理)
- [远程仓库](#远程仓库)
- [工作流](#工作流)
- [常见问题](#常见问题)

---

## 基础命令

### 初始化与配置

```bash
# 初始化仓库
git init

# 配置用户信息
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# 查看配置
git config --list
```

### 状态查看

```bash
# 查看状态
git status

# 查看提交历史
git log
git log --oneline
git log --graph

# 查看差异
git diff
git diff --staged
```

### 提交操作

```bash
# 添加文件
git add file.txt
git add .

# 提交
git commit -m "提交信息"

# 修改上次提交
git commit --amend
```

---

## 分支管理

### 基本操作

```bash
# 创建分支
git branch feature

# 切换分支
git checkout feature
git switch feature

# 创建并切换
git checkout -b feature
git switch -c feature

# 查看分支
git branch
git branch -a
```

### 合并分支

```bash
# 合并分支
git merge feature

# 合并后删除分支
git branch -d feature
```

---

## 远程仓库

### 基本操作

```bash
# 添加远程仓库
git remote add origin https://github.com/user/repo.git

# 推送
git push origin main
git push -u origin main  # 首次推送

# 拉取
git pull origin main

# 克隆
git clone https://github.com/user/repo.git
```

---

## 工作流

### 功能分支工作流

```bash
# 1. 创建功能分支
git checkout -b feature/new-feature

# 2. 开发并提交
git add .
git commit -m "实现新功能"

# 3. 推送到远程
git push origin feature/new-feature

# 4. 创建 Pull Request
# 在 GitHub/GitLab 上操作

# 5. 合并后删除分支
git checkout main
git pull
git branch -d feature/new-feature
```

---

## 常见问题

### Q: 如何撤销修改？

**A:**
```bash
# 撤销工作区修改
git checkout -- file.txt

# 撤销暂存
git reset HEAD file.txt

# 撤销提交（保留修改）
git reset --soft HEAD~1

# 撤销提交（丢弃修改）
git reset --hard HEAD~1
```

### Q: 如何解决冲突？

**A:**
1. 打开冲突文件，找到 `<<<<<<<`、`=======`、`>>>>>>>` 标记
2. 手动选择保留哪个版本
3. 删除冲突标记
4. `git add` 添加解决后的文件
5. `git commit` 提交

### Q: .gitignore 怎么写？

**A:**
```gitignore
# 忽略所有 .log 文件
*.log

# 忽略 build 目录
build/

# 忽略所有 .exe 文件
*.exe

# 但保留 app.exe
!app.exe
```

---

## Git 别名

```bash
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.lg "log --oneline --graph --all"
```
