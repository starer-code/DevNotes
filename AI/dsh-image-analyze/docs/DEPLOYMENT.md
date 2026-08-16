# 部署教学：从零到"粘贴即用看图"

本指南覆盖从全新机器到完整可用的全部步骤，含两个插件的安装、Windows 兼容补丁、验证与排错。

---

## 0. 架构总览

```
┌─ 你（用户）────────────────────────────────────────────┐
│ 粘贴图片 → dsh-image-bridge（桥接）                      │
│   或说"分析最新截图 / 分析 D:\xx\img.png"（本插件直接）    │
└──────────────────────┬─────────────────────────────────┘
                       ▼
        dsh-image-analyze（本插件）→ 视觉模型（mimo-v2.5）
```

| 组件 | 职责 | 必需 |
|---|---|---|
| `dsh-image-analyze`（本插件） | 视觉能力：analyze_images / analyze_document | ✅ 必需 |
| `@kbpoyo/dsh-image-bridge` | 粘贴入口：图片落盘 + 文本标记 | 推荐（粘贴即用） |

---

## 1. 前置环境

| 依赖 | 用途 | 检查命令 |
|---|---|---|
| DeepSeek Harness | 插件运行平台 | `dsh --version` |
| 视觉模型（如 mimo-v2.5） | 图片理解 | 供应商目录中声明 `input: ["text","image"]` |
| Python 3 | 文档解析（PDF 渲染） | `python --version` |
| PyMuPDF | PDF 渲染库 | `python -c "import fitz"`（无则 `pip install pymupdf`） |

> 文档解析非必需：只分析图片/截图可以不装 Python。

---

## 2. 安装本插件

```sh
# 方式 A：本地目录（开发/调试，推荐）
git clone <你的仓库地址> dsh-image-analyze
dsh plugin --profile web add ./dsh-image-analyze

# 方式 B：npm（发布后）
dsh plugin --profile web add dsh-image-analyze
```

**验证挂载**：

```sh
dsh --profile web --dump-config
# 输出中应出现：
#   # == dsh-image-analyze
#   - id: image-analyze
#     name: dsh-image-analyze
```

**验证工具**：重启 `dsh web`，新对话发 `分析 D:\xx\img.png`，模型应调用 `analyze_images`。

---

## 3. 安装 dsh-image-bridge（粘贴即用，可选但推荐）

```sh
dsh plugin --profile web add @kbpoyo/dsh-image-bridge@0.1.0
```

重启后：纯文本模型会话中**粘贴图片**，输入框出现「桥接发送图片」按钮；多模态模型会话按钮自动隐藏。

### 3.1 Windows 兼容补丁（必须！）

桥接插件 0.1.0 的写盘/清理使用 Unix shell 命令（`mkdir -p`、`base64 -d`、`find`、`du`），而 Windows 上 DSH 的 shell 后端是 **PowerShell**（`bash-sandbox` 在 win32 被禁用）——所有命令都会失败，报"图片写入失败（桥接目录不可写或数据无效）"。

**补丁方法**：修改安装包 `lib/index.js`（三处函数，用 Node 原生 fs 替代 shell）：

```js
// 文件：~/.dsh/profiles/web/node_modules/@kbpoyo/dsh-image-bridge/lib/index.js

// ① 文件头新增导入
import { mkdir, writeFile, readFile, readdir, stat, unlink } from 'node:fs/promises'

// ② writeBytesToFile —— 原为 `mkdir -p && base64 -d >`（shell）
const writeBytesToFile = async (b64, path, policy, signal) => {
  try {
    const dir = String(path).replace(/\/[^/]+$/, '')
    await mkdir(dir, { recursive: true })
    await writeFile(path, Buffer.from(b64, 'base64'))
    return path
  } catch (error) {
    console.error('dsh-image-bridge: write failed:', String(error))
    return undefined
  }
}

// ③ pruneDir —— 原为 find/du/cut/xargs（shell），替换为 readdir/stat/unlink 实现
//   （TTL 24h + 512MB 上限，按最旧优先；逻辑等价，代码见本仓库 issue 或上方说明）

// ④ dimsOf —— 原为 `file -b`（shell），替换为 PNG 头解析
const dimsOf = async (path, policy) => {
  try {
    const data = await readFile(path)
    if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47) {
      return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`
    }
  } catch {}
  return undefined
}
```

验证：`node --check lib/index.js`，重启 dsh web，粘贴一张图测试。

> ⚠️ `dsh plugin` 重新安装/升级会覆盖补丁，需重打。

### 3.2 让桥接指引点名本插件（可选加固）

编辑桥接插件 `lib/index.js` 的 `routingInstruction`，在指引末尾追加：

```
\n\n[优先调用] 本环境已提供 analyze_images 工具（内部由视觉模型驱动），请优先调用它读取 [图片附件] 中的图片：参数 images 传 [{"kind":"path","path":"<[图片附件] 中的完整路径>"}]；需要高保真视觉输出（如 HTML/SVG 复刻）时加 mode:"direct"。
```

这样模型收到桥接标记后**必然**调用本插件的工具，不依赖模型自行"发现"。

---

## 4. 端到端验证清单

| # | 操作 | 预期 |
|---|---|---|
| 1 | `dsh --profile web --dump-config` | 两个插件层都在 |
| 2 | 重启后新对话发 `分析 D:\xx\img.png` | 出现 `analyze_images` 工具卡片 + 分析来源 + 内容 |
| 3 | 说 `分析最新截图` | 自动定位截图目录最新有内容的图 |
| 4 | 粘贴图片点「桥接发送图片」 | 发送成功，模型自动调工具看图 |
| 5 | 说 `分析 D:\xx\doc.pdf` | `analyze_document` 渲染页面并分析 |
| 6 | 说 `读取 D:\xx\report.docx 里的图` | 解包内嵌图并分析 |

---

## 5. 排错表

| 现象 | 原因 | 处理 |
|---|---|---|
| 插件加载失败（boot error） | 缺 `inject` 声明 / 依赖服务未挂载 | 检查 `export const inject = ['tools','llm','attachments']` |
| 粘贴报"图片写入失败" | Windows 下桥接插件 Unix 命令失效 | 打 3.1 补丁 |
| 模型收到标记但不调工具 | 工具描述触发语缺失 / 未重启 | 重启；补 3.2 指引 |
| `python 执行失败` | Python 不在 PATH / 缺 pymupdf | `pip install pymupdf`；或设 `IMAGE_ANALYZE_PYTHON` |
| "最新截图"选错图 | 截图目录未覆盖 | 设 `IMAGE_ANALYZE_SCREENSHOT_DIRS`；或检查截图工具保存位置 |
| 空白图被分析 | 误触空捕获 | 已自动跳过；确认 PNG 非纯色 |

---

## 6. 卸载

```sh
dsh plugin --profile web remove dsh-image-analyze
dsh plugin --profile web remove @kbpoyo/dsh-image-bridge
# 重启 dsh web
```
