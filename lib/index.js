/**
 * dsh-import-agent-settings — host half.
 *
 * 扫描各智能体来源（Claude Code / Cursor / Codex / cc-switch），提供
 * /api/dsh-import/sources（盘点）与 /api/dsh-import/run（执行导入）两个
 * 路由给浏览器半区。导入逻辑（lib/import.js）是纯函数，无 DSH 依赖。
 * 所有路由带 loopback-only 信任护栏（读用户文件、写配置，不能暴露到局域网）。
 */
import { detectSources, runImport } from './import.js'

export const name = 'import-agent-settings'

/** webServer 挂 /api 路由；systemPrompt 向模型公告插件存在。 */
export const inject = ['webServer', 'systemPrompt']

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

function makeRoutes(ctx) {
  const guard = (req, res, method) => {
    if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return false }
    if (req.method !== method) { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return false }
    return true
  }
  /** 枚举当前实际加载的插件名（能力级检测用；取不到就空）。 */
  const loadedNames = (ctx) => {
    try {
      const loader = ctx.get('loader')
      const entries = loader?.entries?.() ?? []
      return entries.map((e) => (typeof e === 'string' ? e : e.name || e.id)).filter(Boolean)
    } catch { return [] }
  }
  return [
    {
      kind: 'exact',
      path: '/api/dsh-import/sources',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try { writeJson(res, 200, { ok: true, sources: detectSources(loadedNames(ctx)) }) }
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
          const report = runImport(Array.isArray(body.selections) ? body.selections : [], {
            target: body.target,
            dryRun: body.dryRun === true,
          })
          writeJson(res, 200, { ok: true, report })
        } catch (e) { writeJson(res, 500, { ok: false, error: String(e) }) }
      },
    },
  ]
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'plugin:import-agent-settings',
    order: SECTION_ORDER,
    text: GUIDANCE,
  })
  ctx.effect(() => {
    const disposers = makeRoutes(ctx).map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'import-agent-settings: routes')
}
