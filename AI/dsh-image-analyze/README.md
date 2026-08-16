# dsh-image-analyze

> **DSH（DeepSeek Harness）插件：让纯文本模型也能"看图"。**
> 图片、截图、PDF、Word 文档——统一路由到视觉模型（默认 `mimo-v2.5`）分析，对话模型只负责文字推理。全程同一供应商契约，按需付费。

[English](#) · 中文

---

## ✨ 特性

| 能力 | 说明 |
|---|---|
| 🖼 **四种图片入口** | 指定路径 / "分析最新截图"（免路径）/ 多张一次 / 桥接粘贴（配合 dsh-image-bridge） |
| 📄 **文档解析** | PDF 逐页渲染（PyMuPDF）、Word(.docx) 解包内嵌图，一次送视觉模型分析 |
| 🎯 **确定性视觉路由** | 视觉调用固定走同一供应商路由（`opencode-go`）+ 同一凭据，不引入第三方模型 |
| 💰 **按需付费** | 只有真正看图时才产生视觉调用；`mimo-v2.5` 与主流文本模型同价 |
| 🔁 **两种转述模式** | `relay`（结构化视觉数据：OCR/布局/颜色/SVG）vs `direct`（视觉模型直接产出，零损耗） |
| 🧹 **空白截图自动跳过** | 小文件直跳 + PNG 像素方差检测，误触的空捕获不会浪费一次调用 |
| 📋 **来源可见** | 每次分析返回"分析来源"清单，明确指出实际看了哪些文件 |
| 🔧 **零依赖** | 插件本体纯 ESM、不 import 任何 `@deepseek-ai` 包，本地安装无需 npm registry；文档解析仅需系统 Python |

---

## 🏗 架构与工作原理

```
┌─ 图片入口 ─────────────────────────────────────────────┐
│ ① 指定路径    "分析 D:\xx\img.png"                      │
│ ② 最新截图    "分析最新截图 / 最新两张截图"（免路径）      │
│ ③ 粘贴桥接    dsh-image-bridge 落盘 → [图片附件] 标记     │
│ ④ 文档        "分析 D:\xx\doc.pdf / report.docx"         │
└────────────────────────┬───────────────────────────────┘
                         ▼
              analyze_images / analyze_document 工具
                         │
        ┌────────────────┼──────────────────┐
        ▼                ▼                  ▼
   attachments       ctx.llm.stream       sources
   (持久化图片)    provider: opencode-go   (来源报告)
                   model: mimo-v2.5
                         │
                         ▼
   relay 模式 → 结构化视觉数据（OCR/布局/颜色/SVG）→ 对话模型推理
   direct 模式 → 视觉模型直接产出最终答案（如 HTML 复刻）
```

**设计要点**

1. **按请求选模型，不做会话级切换**：通过 `ctx.llm.stream({ provider, model, ... })` 在**单次请求内**指定视觉模型——对话模型全程不变，零切换成本、零风险。
2. **不走 GUI 上传通道**：DSH 宿主对"纯文本模型会话接收图片"有三层硬拦截（`prompt` RPC 预检 / 适配器全历史检查 / 会话含图后锁模型）。本插件全部绕开：图片以**文件路径**方式进入，视觉调用在工具内部完成，文本模型请求里永远没有图片块。
3. **标准附件生命周期**：路径图片先经 `attachments.saveImage()` 持久化（内容寻址、校验），再以 `ImageBlock` 引用送视觉模型——与 `read_image` 工具同一套机制。
4. **pre-step 兜底改写**：万一图片块进入纯文本模型路由（如桥接失败场景），`agent/pre-step` 会将其改写为 `[图片附件: id]` 文本占位符，保证请求不携带图片字节。

---

## 📦 安装

### 前置要求

- DeepSeek Harness 已安装（`dsh` 命令可用）
- 视觉模型已在你的供应商路由目录中声明 `input: ["text", "image"]`（如 `mimo-v2.5`）
- （仅文档解析需要）Python 3 + PyMuPDF：`pip install pymupdf`

### 方式一：本地目录安装（开发/调试）

```sh
git clone <本仓库地址>   # 或直接拷贝插件目录
dsh plugin --profile web add ./dsh-image-analyze
```

### 方式二：npm 安装（发布后）

```sh
dsh plugin --profile web add dsh-image-analyze
```

### 验证

```sh
dsh --profile web --dump-config        # 应看到 "# == dsh-image-analyze" 层
```

重启 `dsh web` 后，新对话中发 `分析 D:\xx\img.png`，模型应调用 `analyze_images` 工具。

> ⚠️ **每次修改插件代码后只需重启 dsh web**（本地目录安装为实时链接），无需重新 `dsh plugin add`。

---

## ⚙️ 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `IMAGE_ANALYZE_PROVIDER` | `opencode-go` | 视觉调用使用的供应商路由 |
| `IMAGE_ANALYZE_MODEL` | `mimo-v2.5` | 视觉模型 ID（目录内需声明 image 输入） |
| `IMAGE_ANALYZE_PYTHON` | `python` | Python 解释器（文档解析用） |
| `IMAGE_ANALYZE_SCREENSHOT_DIRS` | 见下 | 额外截图目录，`;` 分隔 |

### 截图目录自动发现

优先级顺序（取最新**有内容**的一张）：
1. `Pictures\Screenshots`、`Pictures\屏幕截图`、OneDrive 同款
2. `Pictures` 下名称含"截图/Screen"的目录（**自动发现**，如 `联想截图`、`华为截图`）
3. 环境变量指定的额外目录
4. 兜底：桌面

### 工具参数（模型调用时使用）

| 参数 | 取值 | 说明 |
|---|---|---|
| `images[].kind` | `path` / `screenshot` / `attachment` | 图片来源 |
| `images[].count` | 1~5（默认 1） | `screenshot` 模式取最近 N 张 |
| `mode` | `relay`（默认）/ `direct` | 转述 vs 直接产出 |
| `instruction` | 任意文本 | 提取/分析指令 |
| `max_pages` | 1~20（默认 5） | `analyze_document` 的 PDF 页数上限 |

---

## 📖 使用手册

| 场景 | 指令示例 |
|---|---|
| 分析指定图片 | `分析 D:\projects\xx\img.png` |
| 分析最新截图（免路径） | `分析最新截图` |
| 分析最近 N 张截图 | `分析最新两张截图` |
| 一次多张图 | `分析 D:\a.png 和 D:\b.png` / 粘贴多张（配合桥接） |
| 提取图片文字为表格 | `把这张图的表格转成 Markdown` |
| HTML 高保真复刻 | `用 direct 模式把这张图复刻成 HTML` |
| 分析 PDF | `分析 D:\xx\doc.pdf`（默认前 5 页） |
| 分析 Word 内嵌图 | `读取 D:\xx\report.docx 里的图` |
| 指定 PDF 页数 | `分析 D:\xx\doc.pdf，只要前 10 页` |

---

## 🔌 与 dsh-image-bridge 集成（推荐：粘贴即用）

本插件提供**确定性视觉能力**；[`dsh-image-bridge`](https://github.com/kbpoyo/dsh-image-bridge) 提供**粘贴即用的入口**（纯文本模型下粘贴图片自动落盘为 `[图片附件]` 标记发送）。两者互补：

```
粘贴图片 → 桥接落盘 + [图片附件]标记 → 文本模型 → analyze_images(path) → 视觉模型
```

```sh
dsh plugin --profile web add @kbpoyo/dsh-image-bridge@0.1.0
```

> **Windows 注意**：桥接插件 0.1.0 的写盘/清理使用 Unix shell 命令（`base64 -d`/`find`），在 Windows（pwsh shell 后端）上会失败。需要打一个本地补丁（用 Node fs 替代 shell 调用），详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#windows-补丁)。

---

## 🧪 测试

```sh
# 语法检查
node --check index.js

# 文档解析脚本（需要 Python + pymupdf）
python scripts/pdf2png.py <in.pdf> <out_dir> 5
python scripts/docx2img.py <in.docx> <out_dir>
```

端到端：重启 dsh → 新对话 → 上述"使用手册"任一条指令。

---

## ❓ 常见问题

**Q: 纯文本模型为什么"看不到"原图？**
A: 架构约束（宿主三层硬拦截：prompt 预检 / 适配器全历史检查 / 含图会话锁模型）。本插件的 `relay` 模式把图片编码为结构化视觉数据（OCR/布局/颜色/SVG）交给文本模型，信息损耗已压到架构允许的最低；`direct` 模式则完全零损耗（视觉模型直接产出）。

**Q: 为什么不用"会话切换视觉模型"？**
A: 成本与风险：切换会烧两份模型的 token，且 DSH 规定含图会话**不能**切回纯文本模型。按请求选模型（本插件方式）零切换、按需付费。

**Q: 模型收到 [图片附件] 标记但不调用工具？**
A: 检查工具描述触发语是否生效（重启）；或让桥接指引显式点名本工具（见 DEPLOYMENT 文档）。

**Q: 分析来源显示什么？**
A: 每次调用返回 `sources` 数组（截图模式返回解析到的文件路径，文档模式返回 `文档路径 (页码/图片名)`），随结果一起展示，便于核对模型"看"的是不是你要的那张图。

---

## ⚠️ 已知限制

- **纯文本会话无法原生看图**：图片必须经文件路径/桥接进入，这是 DSH 宿主硬约束，非本插件可绕
- **PDF 页数上限默认 5 页**：成本随页数线性增长，`max_pages` 可调
- **附件引用缓存存进程内存**（200 条上限），进程重启后旧 `[图片附件: id]` 占位符可能无法解析
- **无结果缓存**：同一张图重复分析会重复计费（路线图：同图同指令幂等缓存）
- **path 读取用 `node:fs` 直读**，不经 fs 沙箱策略——个人使用可接受，共享部署需注意
- **DOCX 只提取内嵌图片**，正文文字暂不提取（路线图）

---

## 🗺 路线图

- [ ] 同图同指令幂等缓存（省费用）
- [ ] DOCX 正文文字提取
- [ ] 客户端插件：粘贴图片自动落盘 + 直接调工具（脱离对第三方桥接的依赖）
- [ ] 多供应商路由配置界面

---

## 📄 许可

[MIT](LICENSE)

---

## 🙏 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)——插件运行平台
- [kbpoyo/dsh-image-bridge](https://github.com/kbpoyo/dsh-image-bridge)——粘贴桥接入口
