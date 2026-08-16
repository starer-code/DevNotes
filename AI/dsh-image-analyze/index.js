/**
 * dsh-image-analyze
 *
 * 让纯文本对话模型也能"看图"的插件：图片分析被路由给视觉模型
 * （默认 opencode-go 路由上的 mimo-v2.5），对话本身始终留在文本模型上。
 *
 * 两个机制：
 * 1. `agent/pre-step` 拦截：当当前模型路由声明纯文本输入时，把用户消息里的
 *    ImageBlock 改写成 `[图片附件: <attachmentId>]` 文本占位符（同时把精确的
 *    ImageAttachmentRef 记录在进程内 map 中），保证文本模型的请求永远不带图片字节。
 * 2. `analyze_images` 工具：模型看到占位符/文件路径后调用它；工具经
 *    ctx.attachments 解析字节，再通过 ctx.llm 以视觉模型发起一次性请求，
 *    返回提取的文本。整个过程不新增任何供应商、不改对话模型。
 *
 * 零依赖：不 import 任何 @deepseek-ai 包，只使用 Cordis 运行时暴露的
 * ctx.on / ctx.get / ctx.tools.register / ctx.llm.stream 等稳定表面，
 * 因此本地安装无需访问 npm registry。
 */

import { readFile, readdir, stat, rm, mkdtemp } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { execFile } from 'node:child_process'
import os from 'node:os'

export const name = 'image-analyze'

/** Cordis 依赖注入声明：apply 内属性访问（ctx.tools 等）必须先声明。 */
export const inject = ['tools', 'llm', 'attachments']

/** 扩展名 → 媒体类型（与附件服务的准入集合一致）。 */
const MEDIA_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** 截图自动定位的候选目录：primary 为专属截图目录（含动态发现），fallback 仅兜底。 */
async function screenshotSearchDirs() {
  const home = os.homedir()
  const primary = [
    join(home, 'Pictures', 'Screenshots'), // 标准截图目录
    join(home, 'Pictures', '屏幕截图'), // 中文系统
    join(home, 'OneDrive', 'Pictures', 'Screenshots'),
    join(home, 'OneDrive', '图片', '屏幕截图'),
  ]
  const fallback = [join(home, 'Desktop')]
  const extra = process.env.IMAGE_ANALYZE_SCREENSHOT_DIRS
  if (extra !== undefined) {
    for (const dir of extra.split(';')) {
      const trimmed = dir.trim()
      if (trimmed.length > 0) primary.push(trimmed)
    }
  }
  // 动态发现 Pictures 下名称含"截图/Screen"的目录（如联想截图、华为截图等），自动纳入
  try {
    const pictures = join(home, 'Pictures')
    for (const entry of await readdir(pictures, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!/截图|screen/i.test(entry.name)) continue
      const dir = join(pictures, entry.name)
      if (!primary.includes(dir)) primary.push(dir)
    }
  } catch {
    // Pictures 目录不存在则忽略
  }
  return { primary, fallback }
}

/** 在给定目录组中收集最新图片（按修改时间倒序，限量）。 */
async function listNewestImages(dirs, limit) {
  const found = []
  for (const dir of dirs) {
    let entries
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!Object.prototype.hasOwnProperty.call(MEDIA_BY_EXT, extname(entry).toLowerCase())) continue
      const full = join(dir, entry)
      try {
        const info = await stat(full)
        if (!info.isFile()) continue
        found.push({ path: full, mtimeMs: info.mtimeMs })
      } catch {
        // 单个文件不可读则跳过
      }
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found.slice(0, limit)
}

/** 空白/纯色 PNG 检测：解码后按网格采样像素，方差极低即视为空白捕获。 */
function pngIsBlank(data) {
  try {
    // PNG 签名 89 50 4E 47 0D 0A 1A 0A
    if (data.length < 33 || data.readUInt32BE(0) !== 0x89504e47) return false
    let off = 8
    let width = 0
    let height = 0
    let bitDepth = 0
    let colorType = 0
    const idat = []
    while (off + 8 <= data.length) {
      const len = data.readUInt32BE(off)
      const type = data.toString('ascii', off + 4, off + 8)
      if (type === 'IHDR') {
        width = data.readUInt32BE(off + 8)
        height = data.readUInt32BE(off + 12)
        bitDepth = data[off + 16]
        colorType = data[off + 17]
      } else if (type === 'IDAT') {
        idat.push(data.subarray(off + 8, off + 8 + len))
      } else if (type === 'IEND') {
        break
      }
      off += 12 + len
    }
    // 只处理 8 位深常见颜色类型；其余按"非空白"保守处理
    const channels = [0, 3, 3, 1, 2, 0, 4][colorType] ?? 0
    if (width === 0 || height === 0 || bitDepth !== 8 || channels === 0) return false
    const stride = width * channels
    const raw = inflateSync(Buffer.concat(idat))
    if (raw.length < height * stride) return false
    // 逐行还原 filter（None/Sub/Up/Average/Paeth）
    const out = Buffer.alloc(height * stride)
    let prev = Buffer.alloc(stride)
    let pos = 0
    for (let y = 0; y < height; y++) {
      const filter = raw[pos++]
      const line = raw.subarray(pos, pos + stride)
      pos += stride
      const target = out.subarray(y * stride, (y + 1) * stride)
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? target[x - channels] : 0
        const b = prev[x]
        const c = x >= channels ? prev[x - channels] : 0
        let v = line[x]
        switch (filter) {
          case 0:
            break
          case 1:
            v = (v + a) & 0xff
            break
          case 2:
            v = (v + b) & 0xff
            break
          case 3:
            v = (v + ((a + b) >> 1)) & 0xff
            break
          case 4: {
            const p = a + b - c
            const pa = Math.abs(p - a)
            const pb = Math.abs(p - b)
            const pc = Math.abs(p - c)
            v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
            break
          }
          default:
            return false
        }
        target[x] = v
      }
      prev = target
    }
    // 网格采样亮度，算方差
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 200)))
    let sum = 0
    let sum2 = 0
    let n = 0
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = y * stride + x * channels
        let lum
        if (channels === 1) {
          lum = out[i]
        } else {
          lum = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]
        }
        sum += lum
        sum2 += lum * lum
        n++
      }
    }
    if (n === 0) return false
    const mean = sum / n
    const variance = sum2 / n - mean * mean
    // 纯色图（方差极小）视为空白捕获
    return variance < 8
  } catch {
    return false
  }
}

/** 文件是否疑似空白捕获：极小文件直接跳过；PNG 做像素方差检测。 */
async function isBlankImage(path) {
  try {
    const data = await readFile(path)
    if (data.length < 512) return true
    if (extname(path).toLowerCase() !== '.png') return false
    return pngIsBlank(data)
  } catch {
    return false
  }
}

/** 截图目录优先，逐个跳过空白捕获，返回最新的 N 张有内容的图（不足则返回全部）。 */
async function findLatestScreenshots(count) {
  const { primary, fallback } = await screenshotSearchDirs()
  const candidates = [
    ...(await listNewestImages(primary, Math.max(count, 5))),
    ...(await listNewestImages(fallback, Math.max(count, 3))),
  ]
  const result = []
  for (const candidate of candidates) {
    if (result.length >= count) break
    if (await isBlankImage(candidate.path)) continue
    result.push(candidate.path)
  }
  return result
}

/** 最新一张非空白截图；找不到返回 null。 */
async function findLatestScreenshot() {
  const found = await findLatestScreenshots(1)
  return found.length > 0 ? found[0] : null
}

/** 视觉模型路由（可被环境变量覆盖，仍是 opencode-go 内部契约）。 */
const VISION_PROVIDER = process.env.IMAGE_ANALYZE_PROVIDER || 'opencode-go'
const VISION_MODEL = process.env.IMAGE_ANALYZE_MODEL || 'mimo-v2.5'

/** relay 模式的默认指令：把图片编码成机器可读的结构化视觉数据（近似无损转述）。 */
const DEFAULT_INSTRUCTION =
  '你是对话模型的"视觉编码器"。请把这张图片转成结构化视觉数据输出，分四节，尽量精确不要概括：\n' +
  '## OCR 文本\n' +
  '逐字列出图中每一段文字（标题/按钮/表格/代码/报错/文件名等），保留原始措辞，每段标注大致位置（如"顶部居中"）。\n' +
  '## 布局清单\n' +
  '每个可见元素一行：类型（按钮/输入框/标签/树节点/图标/分隔条/选项卡…）| 位置（左中右+上下，或百分比）| 尺寸 | 主色 hex | 文字内容。\n' +
  '## 颜色表\n' +
  '图中主要颜色及用途（背景/边框/选中/警告/文字…），给出精确 hex 值。\n' +
  '## SVG 复刻\n' +
  '输出一段 SVG 代码，用 1280x800 视口尽量精确还原整体布局与配色，元素用 rect/text/path/line 表达，文字内容用 <text> 真实写入，颜色用精确 hex。'

/** direct 模式的默认指令：让视觉模型直接产出最终结果，不经转述。 */
const DIRECT_INSTRUCTION =
  '你是唯一能看到这张图片的模型，请直接基于图片内容完成用户要求并输出最终结果；' +
  '如果用户要求 HTML/CSS/SVG 复刻，请直接输出完整可渲染的代码；不要转述、不要概括，你的输出就是最终答案。'

/** 文档解析：Python 解释器与内置脚本（PDF 用 PyMuPDF 渲染，DOCX 用 zipfile 解包）。 */
const PYTHON = process.env.IMAGE_ANALYZE_PYTHON || 'python'
const SCRIPTS_DIR = join(import.meta.dirname, 'scripts')

/** 运行一个内置 Python 脚本，返回 stdout；失败抛出带 stderr 的错误。 */
function runPython(scriptPath, args, signal) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, ['-u', scriptPath, ...args], { signal, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`python 执行失败（${basename(scriptPath)}）: ${String(stderr || error.message).slice(0, 300)}`))
      } else {
        resolve(String(stdout).trim())
      }
    })
  })
}

/** attachmentId → 精确 ImageAttachmentRef 的内存缓存上限。 */
const MAX_CACHED_REFS = 200

export function apply(ctx) {
  /** 拦截到的图片附件精确引用：attachmentId → ImageAttachmentRef。 */
  const refsByAttachment = new Map()

  // -------------------------------------------------------------------------
  // 1) agent/pre-step：纯文本路由下，把图片块改写成文本占位符
  // -------------------------------------------------------------------------
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || payload.signal.aborted) return decision
    // 若当前路由本身支持图片（例如用户手动切到 mimo-v2.5），不做改写。
    if (await routeAcceptsImages(payload.agent, ctx, payload.signal)) return decision

    let changed = false
    const messages = decision.messages.map((msg) => {
      if (msg.role !== 'user') return msg
      const hasImage = msg.content.some((block) => block.type === 'image')
      if (!hasImage) return msg
      changed = true
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type !== 'image') return block
          const ref = block.attachment
          rememberRef(refsByAttachment, ref)
          return { type: 'text', text: `[图片附件: ${ref.attachmentId}]` }
        }),
      }
    })
    return changed ? { kind: 'enter', messages } : decision
  })

  // -------------------------------------------------------------------------
  // 2) analyze_images 工具：把图片交给视觉模型，返回提取文本
  // -------------------------------------------------------------------------
  ctx.tools.register({
    name: 'analyze_images',
    description:
      'Analyze one or more images with a vision model and return the extracted content as text. ' +
      'Call this whenever the user provides images — image file paths, uploaded attachments ' +
      '(visible as "[图片附件: ...]" placeholders), or says "分析最新截图" (use kind "screenshot") — ' +
      'and you need to read, describe, transcribe, or extract information from them. ' +
      'IMPORTANT: when a user message contains a "[图片附件]" bridge marker with an image path ' +
      '(e.g. "<cwd>/.dsh-image-bridge/img-...png" or any other path), call this tool with ' +
      'kind "path" using that exact path — do not ask the user for the image. ' +
      'For high-fidelity visual output tasks (e.g. reproducing the image as HTML/CSS/SVG), use mode "direct" ' +
      'so the vision model produces the final answer itself; otherwise the relayed structured data is returned.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        images: {
          type: 'array',
          minItems: 1,
          description:
            'Images to analyze. kind "path" with path for image files on disk; ' +
            'kind "screenshot" (no other fields) for the most recent non-blank screenshot ' +
            '(set count to analyze the latest N, e.g. 2 for "最新两张截图"); ' +
            'kind "attachment" with attachmentId for uploaded images ' +
            '(the id appears in "[图片附件: <id>]" placeholders).',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['attachment', 'path', 'screenshot'] },
              attachmentId: { type: 'string', description: 'Attachment id of an uploaded image.' },
              mediaType: { type: 'string', description: 'Optional media type hint, e.g. image/png.' },
              path: { type: 'string', description: 'Absolute path to an image file (png/jpg/jpeg/webp/gif).' },
              count: { type: 'integer', description: 'For kind "screenshot": how many recent screenshots to analyze (1-5, default 1).' },
            },
            required: ['kind'],
          },
        },
        instruction: {
          type: 'string',
          description: 'Optional analysis instruction, e.g. "提取表格并转成 Markdown" or "描述这张图的界面布局".',
        },
        mode: {
          type: 'string',
          enum: ['relay', 'direct'],
          description:
            '"relay" (default): the vision model encodes the image into structured data (OCR/layout/colors/SVG) for the ' +
            'conversation model to reason over. "direct": the vision model directly produces the final answer from the image ' +
            '(zero relay loss) — use for high-fidelity visual output tasks such as reproducing the image as HTML/CSS.',
        },
      },
      required: ['images'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          images: { type: 'integer' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'images', 'sources'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.sources.length > 0 ? `分析来源：\n${value.sources.map((s) => `- ${s}`).join('\n')}\n\n` : ''}${value.text}`,
      }],
    },
    presentCall(args) {
      const images = Array.isArray(args.images) ? args.images : []
      const locations = images
        .filter((img) => img && img.kind === 'path' && typeof img.path === 'string')
        .map((img) => ({ path: img.path }))
      const card = { card: 'generic', title: `Analyze ${images.length} image(s)`, kind: 'read' }
      return locations.length > 0 ? { ...card, locations } : card
    },
    async execute(args, exec) {
      const llm = ctx.get('llm')
      const attachments = ctx.get('attachments')
      if (!llm) throw new Error('analyze_images: the llm service is not mounted')
      if (!attachments) throw new Error('analyze_images: the attachment service is not mounted')
      if (!Array.isArray(args.images) || args.images.length === 0) {
        throw new Error('analyze_images: images must be a non-empty array')
      }

      // 解析每个图片来源为持久化的 ImageAttachmentRef，构建模型可见块。
      const blocks = []
      const sources = []
      let instructionNote = ''
      for (const img of args.images) {
        if (!img || typeof img !== 'object') throw new Error('analyze_images: each image entry must be an object')
        if (img.kind === 'attachment') {
          if (typeof img.attachmentId !== 'string' || img.attachmentId.length === 0) {
            throw new Error('analyze_images: attachment entries need a non-empty attachmentId')
          }
          const known = refsByAttachment.get(img.attachmentId)
          const ref = known ?? {
            attachmentId: img.attachmentId,
            mediaType: img.mediaType,
            width: 0,
            height: 0,
            bytes: 0,
          }
          // readImage 会按引用重新校验摘要/尺寸/元数据，不匹配即抛错。
          const stored = await attachments.readImage(ref, exec.signal)
          blocks.push({ type: 'image', attachment: stored.ref })
          sources.push(`attachment:${ref.attachmentId}`)
        } else if (img.kind === 'path' || img.kind === 'screenshot') {
          const targets = []
          if (img.kind === 'screenshot') {
            const count = Math.min(Math.max(Number.isInteger(img.count) ? img.count : 1, 1), 5)
            const found = await findLatestScreenshots(count)
            if (found.length === 0) {
              throw new Error(
                'analyze_images: 未能在常见截图目录找到有内容的图片；请开启截图自动保存（截图工具设置→自动保存），或改用 kind:"path" 指定文件',
              )
            }
            targets.push(...found)
            if (found.length > 1) {
              instructionNote = `共 ${found.length} 张截图，请逐张描述内容，忽略空白或无意义的图。`
            }
          } else {
            targets.push(img.path)
          }
          for (const targetPath of targets) {
            if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
              throw new Error('analyze_images: path entries need a non-empty path')
            }
            const mediaType = MEDIA_BY_EXT[extname(targetPath).toLowerCase()]
            if (mediaType === undefined) {
              throw new Error(`analyze_images: "${targetPath}" is not a supported image (png/jpg/jpeg/webp/gif)`)
            }
            if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
              throw new Error(`analyze_images: ${mediaType} is not accepted by this deployment`)
            }
            const cap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
            const data = await readFile(targetPath, { signal: exec.signal })
            if (data.length === 0) throw new Error(`analyze_images: "${targetPath}" is empty`)
            if (data.length > cap) throw new Error(`analyze_images: "${targetPath}" exceeds the ${cap}-byte image limit`)
            // 与 read_image 同一生命周期：先持久化，再引用。
            const ref = await attachments.saveImage({ data, mediaType, name: basename(targetPath) })
            blocks.push({ type: 'image', attachment: ref })
            sources.push(targetPath)
          }
        } else {
          throw new Error(`analyze_images: unknown image kind "${img.kind}"`)
        }
      }

      const mode = args.mode === 'direct' ? 'direct' : 'relay'
      const userInstruction =
        typeof args.instruction === 'string' && args.instruction.trim().length > 0
          ? args.instruction.trim()
          : null
      const baseInstruction = userInstruction ?? (mode === 'direct' ? DIRECT_INSTRUCTION : DEFAULT_INSTRUCTION)
      const finalInstruction = instructionNote.length > 0 ? `${baseInstruction}\n${instructionNote}` : baseInstruction
      blocks.push({ type: 'text', text: finalInstruction })

      // 一次性视觉请求：同一适配器、同一供应商路由、同一凭据。
      const stream = llm.stream({
        provider: VISION_PROVIDER,
        model: VISION_MODEL,
        messages: [{ role: 'user', content: blocks }],
        signal: exec.signal,
      })

      let text = ''
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          text += chunk.text
        } else if (chunk.type === 'finish') {
          if (chunk.reason === 'error') {
            throw new Error(`analyze_images: vision call failed on ${VISION_PROVIDER}/${VISION_MODEL}`)
          }
          if (chunk.reason === 'aborted') throw new Error('analyze_images: aborted')
        }
      }
      if (text.trim().length === 0) text = '(vision model returned no text)'
      return { text, images: blocks.filter((block) => block.type === 'image').length, sources }
    },
  })

  // -------------------------------------------------------------------------
  // 3) analyze_document 工具：PDF/docx 内多图 → 渲染/解包 → 视觉模型分析
  // -------------------------------------------------------------------------
  ctx.tools.register({
    name: 'analyze_document',
    description:
      'Extract and analyze images from a document (PDF or Word .docx) with the vision model. ' +
      'PDF: renders pages to images (PyMuPDF); DOCX: extracts embedded images from word/media. ' +
      'Call this whenever the user provides a PDF or Word file and wants its content read, ' +
      'transcribed, or analyzed (e.g. "分析这个 PDF", "读取文档里的图").',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        doc_path: { type: 'string', description: 'Absolute path to the PDF or .docx file.' },
        instruction: { type: 'string', description: 'Optional analysis instruction.' },
        max_pages: {
          type: 'integer',
          description: 'PDF: max pages to render (1-20, default 5). Cost grows with the number of pages.',
        },
      },
      required: ['doc_path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          images: { type: 'integer' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'images', 'sources'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.sources.length > 0 ? `分析来源：\n${value.sources.map((s) => `- ${s}`).join('\n')}\n\n` : ''}${value.text}`,
      }],
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Analyze document ${basename(String(args.doc_path ?? ''))}`,
        kind: 'read',
        locations: [{ path: String(args.doc_path ?? '') }],
      }
    },
    async execute(args, exec) {
      const llm = ctx.get('llm')
      const attachments = ctx.get('attachments')
      if (!llm) throw new Error('analyze_document: the llm service is not mounted')
      if (!attachments) throw new Error('analyze_document: the attachment service is not mounted')

      const docPath = String(args.doc_path ?? '').trim()
      if (docPath.length === 0) throw new Error('analyze_document: doc_path is required')
      const ext = extname(docPath).toLowerCase()
      if (ext !== '.pdf' && ext !== '.docx') {
        throw new Error(`analyze_document: unsupported document type "${ext}" (only .pdf / .docx)`)
      }
      const maxPages = Math.min(Math.max(Number.isInteger(args.max_pages) ? args.max_pages : 5, 1), 20)

      const tmpDir = await mkdtemp(join(os.tmpdir(), 'dsh-imgdoc-'))
      const blocks = []
      const sources = []
      try {
        // 1) 渲染/解包：得到页面或内嵌图片文件
        let rendered = []
        if (ext === '.pdf') {
          const out = await runPython(join(SCRIPTS_DIR, 'pdf2png.py'), [docPath, tmpDir, String(maxPages)], exec.signal)
          const n = Number((out.match(/^OK (\d+)/) ?? [])[1] ?? '0')
          if (n > 0) rendered = (await readdir(tmpDir)).filter((f) => f.endsWith('.png')).sort().map((f) => join(tmpDir, f))
        } else {
          const out = await runPython(join(SCRIPTS_DIR, 'docx2img.py'), [docPath, tmpDir], exec.signal)
          const n = Number((out.match(/^OK (\d+)/) ?? [])[1] ?? '0')
          if (n > 0) {
            rendered = (await readdir(tmpDir))
              .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
              .sort()
              .map((f) => join(tmpDir, f))
          }
        }
        if (rendered.length === 0) {
          throw new Error(`analyze_document: "${docPath}" 未提取到任何图片（PDF 渲染失败或文档无内嵌图片）`)
        }

        // 2) 与 analyze_images 同一生命周期：持久化附件后构建图片块（受总量限制）
        const cap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
        let totalBytes = 0
        for (const file of rendered) {
          const mediaType = MEDIA_BY_EXT[extname(file).toLowerCase()]
          if (mediaType === undefined) continue
          let data
          try {
            data = await readFile(file)
          } catch {
            continue
          }
          if (data.length === 0 || data.length > cap) continue
          if (totalBytes + data.length > cap) {
            sources.push(`${docPath} (${basename(file)} 已跳过：超出消息图片总量限制)`)
            continue
          }
          const ref = await attachments.saveImage({ data, mediaType, name: basename(file) })
          blocks.push({ type: 'image', attachment: ref })
          totalBytes += data.length
          sources.push(`${docPath} (${basename(file)})`)
        }
        if (blocks.length === 0) {
          throw new Error('analyze_document: 提取的图片全部为空或超出大小限制')
        }

        // 3) 一次性视觉请求（同供应商、同凭据）
        const userInstruction =
          typeof args.instruction === 'string' && args.instruction.trim().length > 0 ? args.instruction.trim() : null
        const instruction = userInstruction ??
          `这是文档 ${basename(docPath)} 提取出的 ${blocks.length} 张页面/图片，请逐张完整提取文字与内容（PDF 按页码顺序标注），忽略空白页，不要概括。`
        blocks.push({ type: 'text', text: instruction })

        const stream = llm.stream({
          provider: VISION_PROVIDER,
          model: VISION_MODEL,
          messages: [{ role: 'user', content: blocks }],
          signal: exec.signal,
        })
        let text = ''
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') {
            text += chunk.text
          } else if (chunk.type === 'finish') {
            if (chunk.reason === 'error') {
              throw new Error(`analyze_document: vision call failed on ${VISION_PROVIDER}/${VISION_MODEL}`)
            }
            if (chunk.reason === 'aborted') throw new Error('analyze_document: aborted')
          }
        }
        if (text.trim().length === 0) text = '(vision model returned no text)'
        return { text, images: blocks.filter((block) => block.type === 'image').length, sources }
      } finally {
        rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      }
    },
  })
}

/** 有界记录附件引用（Map 保持插入序，超出上限淘汰最旧）。 */
function rememberRef(map, ref) {
  if (map.size >= MAX_CACHED_REFS) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(String(ref.attachmentId), ref)
}

/** 当前 agent 路由是否声明图片输入（决定 pre-step 是否改写）。 */
async function routeAcceptsImages(agent, ctx, signal) {
  const llm = ctx.get('llm')
  if (!llm) return false
  try {
    const header = agent?.session?.requestHeader?.()
    const provider = header?.config?.provider ?? agent?.options?.provider
    const model = header?.config?.model ?? agent?.options?.model
    if (provider === undefined || model === undefined) return false
    const info = await llm.resolveModelInfo(provider, model, signal)
    return info.inputModalities?.includes('image') === true
  } catch {
    // 解析失败按纯文本处理（改写更安全）。
    return false
  }
}

// 测试钩子（cordis loader 只读取 name/inject/apply，多余导出无副作用）
export { findLatestScreenshot, findLatestScreenshots, isBlankImage, pngIsBlank }
