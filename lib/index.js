/**
 * dsh-import-agent-settings — host half.
 *
 * 扫描各智能体来源（Claude Code / Cursor / Codex / cc-switch），提供
 * /api/dsh-import/sources（盘点）与 /api/dsh-import/run（执行导入）两个
 * 路由给浏览器半区。导入逻辑（lib/import.js）是纯函数，无 DSH 依赖。
 * 所有路由带 loopback-only 信任护栏（读用户文件、写配置，不能暴露到局域网）。
 */
import { detectSources, runImport, targetOptions } from './import.js'
import Schema from '@deepseek-ai/schemastery'

export const name = 'import-agent-settings'

/** webServer 挂 /api 路由；systemPrompt 向模型公告插件存在。 */
export const inject = ['webServer', 'systemPrompt']

/**
 * 插件配置。在 cordis.patch.yml 的 `- id: ui-import-agent-settings` 行下写 config 覆盖，
 * 例如：
 *   config:
 *     profile: web
 *     target: patch
 *     roots:
 *       claude-code: 'D:/agents/.claude'
 */
export const Config = Schema.object({
  profile: Schema.string().default('web')
    .description('MCP 组合层落点（cordis.patch.yml）所属 profile 名'),
  target: Schema.union(['auto', 'patch', 'mcp-json']).default('auto')
    .description('MCP 导入落点：auto=自动检测，patch=组合层，mcp-json=~/.dsh/mcp.json'),
  ccSwitchDb: Schema.string().default('')
    .description('cc-switch.db 绝对路径；留空自动检测 CC_SWITCH_DB 环境变量或 ~/.cc-switch'),
  roots: Schema.dict(Schema.string()).default({})
    .description('来源根目录覆盖，合法键：claude-code / cursor / codex / cc-switch'),
})

const SECTION_ORDER = 160
const GUIDANCE =
  '本机已安装 dsh-import-agent-settings 插件（导入智能体设置）：设置 → 通用设置 → 「导入智能体设置」。' +
  '能力：从 Claude Code / Cursor / Codex / cc-switch 一键导入 MCP 服务器与 Skills 到 DSH（MCP 写入官方组合层 cordis.patch.yml 或 ~/.dsh/mcp.json，Skills 复制到 ~/.dsh/skills）。' +
  '限制：模型路由、记忆、会话迁移等能力由社区插件按能力处理，本插件只做检测与提示，不包含也不自动安装这些插件。' +
  '用户提到「导入设置 / 迁移 / 从 Claude 搬过来」时即指本插件。'

function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

const MAX_BODY_BYTES = 1024 * 1024

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch { return undefined }
}

function makeRoutes(ctx, config) {
  /** 由 Config 构造的业务层选项：roots 覆盖 / ccSwitchDb 路径 / 落点 profile。 */
  const pluginOpts = {
    roots: config.roots,
    ccSwitchDb: config.ccSwitchDb || undefined,
    profile: config.profile,
  }
  const guard = (req, res, method) => {
    if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return false }
    if (req.method !== method) { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return false }
    return true
  }
  /** 枚举当前实际加载的插件名（能力级检测用；取不到就空）。
   *  注意 loader.entries() 是 generator，必须先展开再 map——直接 .map 会抛 TypeError。 */
  const loadedNames = (ctx) => {
    try {
      const loader = ctx.get('loader')
      const entries = loader?.entries?.() ?? []
      return [...entries].map((e) => (typeof e === 'string' ? e : e.name || e.id)).filter(Boolean)
    } catch { return [] }
  }
  /** 枚举当前已注册工具的 {name, description}（能力级检测的硬证据；取不到就空）。
   *  ToolRuntime.schemas() 返回全部可见工具的模型面 schema，无需任何 agent scope。 */
  const toolSchemas = (ctx) => {
    try {
      const tools = ctx.get('tools')
      const schemas = tools?.schemas?.() ?? []
      return schemas.map((s) => ({ name: s.name, description: s.description ?? '' })).filter((s) => s.name)
    } catch { return [] }
  }
  /** 能力检测证据包：插件名（软猜测）+ 已注册工具（硬证据）。 */
  const collectEvidence = (ctx) => ({ names: loadedNames(ctx), tools: toolSchemas(ctx) })
  return [
    {
      kind: 'exact',
      path: '/api/dsh-import/sources',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          writeJson(res, 200, {
            ok: true,
            sources: detectSources(collectEvidence(ctx), pluginOpts),
            targets: targetOptions(config.profile),
            // 前端选择器的初始值跟随 Config 的 target
            defaultTarget: config.target,
          })
        }
        catch (e) { writeJson(res, 500, { ok: false, error: String(e) }) }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-import/run',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (!body) { writeJson(res, 400, { ok: false, error: 'invalid json body' }); return }
        try {
          const report = await runImport(Array.isArray(body.selections) ? body.selections : [], {
            ...pluginOpts,
            // 请求级 target 优先，未带则用 Config 默认值
            target: body.target ?? config.target,
            dryRun: body.dryRun === true,
          })
          writeJson(res, 200, { ok: true, report })
        } catch (e) { writeJson(res, 500, { ok: false, error: String(e) }) }
      },
    },
  ]
}

export function apply(ctx, config) {
  ctx.systemPrompt.section({
    name: 'plugin:import-agent-settings',
    order: SECTION_ORDER,
    text: GUIDANCE,
  })
  ctx.effect(() => {
    const disposers = makeRoutes(ctx, config).map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'import-agent-settings: routes')
}
