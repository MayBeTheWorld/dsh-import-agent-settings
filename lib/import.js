/**
 * lib/import.js — 导入智能体设置 · 纯业务逻辑（无 DSH 运行时依赖，可独立冒烟测试）
 *
 * 来源检测 + 类别盘点 + MCP/Skills 导入管线。落点默认是官方组合层
 * cordis.patch.yml（无插件/Hanihahaha UI/官方版通用）；zebbkira 版 UI 的
 * ~/.dsh/mcp.json 作为可选落点（auto 检测）。
 */
import {
  existsSync, readFileSync, copyFileSync, rmSync, mkdirSync,
  cpSync, readdirSync, statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { createRequire } from 'node:module'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const nodeRequire = createRequire(import.meta.url)

export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

/** 受支持的来源 id 集合（config.roots 的合法键）。 */
export const SOURCE_IDS = ['claude-code', 'cursor', 'codex', 'cc-switch']

/** 各来源的默认根目录。 */
export function defaultRoots() {
  const home = homedir()
  return {
    'claude-code': join(home, '.claude'),
    cursor: join(home, '.cursor'),
    codex: join(home, '.codex'),
    'cc-switch': join(home, '.cc-switch'),
  }
}

/** 合并 config.roots 覆盖项（忽略未知键与空值），返回完整根目录表。 */
function resolveRoots(overrides) {
  const roots = defaultRoots()
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides)) {
      if (SOURCE_IDS.includes(k) && typeof v === 'string' && v) roots[k] = v
    }
  }
  return roots
}

// ── 通用读取/解析 ───────────────────────────────────────────────────────
function readJson(path, silent = false) {
  try {
    if (!existsSync(path)) { if (!silent) return null; return null }
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) { if (!silent) return null; return null }
}

/** 从 JSON 文档提取 {name, config}；支持 mcpServers 对象与 DSH servers 数组。 */
export function extractFromJson(doc) {
  if (!doc || typeof doc !== 'object') return null
  if (Array.isArray(doc.servers)) {
    const list = doc.servers.filter((s) => s && typeof s === 'object' && typeof s.name === 'string')
    return list.length ? list.map((s) => ({ name: s.name, config: s })) : null
  }
  if (doc.mcpServers && typeof doc.mcpServers === 'object') {
    const list = Object.entries(doc.mcpServers).filter(([, c]) => c && typeof c === 'object')
      .map(([n, c]) => ({ name: n, config: c }))
    return list.length ? list : null
  }
  return null
}

/** 轻量 TOML：提取 [mcp_servers.<name>] 段的 command/args/env。 */
export function extractFromCodexToml(path) {
  let raw
  try { raw = readFileSync(path, 'utf8') } catch { return null }
  const sections = {}
  let current = ''
  for (let line of raw.split(/\r?\n/)) {
    line = line.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, '')
    if (!line || line.startsWith('#')) continue
    const sec = line.match(/^\[([^\]]+)\]\s*$/)
    if (sec) { current = sec[1].trim(); sections[current] = sections[current] || {}; continue }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (kv && current) sections[current][kv[1]] = parseTomlValue(kv[2])
  }
  const out = []
  for (const [sec, kv] of Object.entries(sections)) {
    const m = sec.match(/^mcp_servers\.(.+)$/)
    if (!m || !kv.command) continue
    out.push({ name: m[1], config: { type: 'stdio', command: kv.command, args: kv.args ?? [], env: kv.env ?? {} } })
  }
  return out.length ? out : null
}

function parseTomlValue(s) {
  s = s.trim()
  if (s.startsWith('[')) {
    return [...s.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2])
  }
  if (s.startsWith('{')) {
    const obj = {}
    for (const m of s.matchAll(/([A-Za-z0-9_.-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^']*)')/g)) {
      obj[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\"/g, '"') : m[2].slice(1, -1)
    }
    return obj
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
  return s
}

/** 转换 mcpServers 风格配置项 → DSH 服务器定义（含 sse 等不支持项的说明）。 */
export function toDshServer(name, cfg) {
  const base = { name, transport: 'stdio', enabled: true }
  const type = cfg.type ?? 'stdio'
  if (type === 'stdio') {
    if (!cfg.command || typeof cfg.command !== 'string') return { ok: false, reason: `stdio 需要 command（${name}）` }
    return { ok: true, server: { ...base, command: cfg.command, args: Array.isArray(cfg.args) ? cfg.args : [], env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {}, cwd: typeof cfg.cwd === 'string' ? cfg.cwd : '' } }
  }
  if (type === 'http' || type === 'streamable-http') {
    if (!cfg.url) return { ok: false, reason: `http 需要 url（${name}）` }
    return { ok: true, server: { name, transport: 'streamable-http', enabled: true, url: cfg.url, headers: cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {} } }
  }
  return { ok: false, reason: `不支持的 type "${type}"（${name}）→ DSH 只支持 stdio/streamable-http` }
}

// ── 来源检测 ────────────────────────────────────────────────────────────
function countSkillDirs(root) {
  if (!existsSync(root)) return 0
  let n = 0
  try {
    for (const entry of readdirSync(root)) {
      const p = join(root, entry)
      if (!statSync(p).isDirectory()) continue
      if (existsSync(join(p, 'SKILL.md')) || existsSync(join(p, 'skill.md'))) n++
    }
  } catch { /* ignore */ }
  return n
}

function countMcpFromFile(path) {
  const doc = readJson(path, true)
  if (doc) {
    const entries = extractFromJson(doc)
    if (entries) return entries.length
  }
  const toml = extractFromCodexToml(path)
  if (toml) return toml.length
  return 0
}

function countMemoryFiles(claudeRoot) {
  const projects = join(claudeRoot, 'projects')
  if (!existsSync(projects)) return 0
  let n = 0
  try {
    for (const proj of readdirSync(projects)) {
      const mem = join(projects, proj, 'memory')
      if (!existsSync(mem)) continue
      n += readdirSync(mem).filter((f) => f.endsWith('.md')).length
    }
  } catch { /* ignore */ }
  return n
}

/** 读取 cc-switch.db（node:sqlite，实验特性；失败返回 null）。
 *  @param dbPath 可选，默认取 CC_SWITCH_DB 环境变量或 ~/.cc-switch/cc-switch.db。 */
export function readCcSwitchDb(dbPath = process.env.CC_SWITCH_DB || join(homedir(), '.cc-switch', 'cc-switch.db')) {
  if (!existsSync(dbPath)) return null
  try {
    const { DatabaseSync } = nodeRequire('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const out = { providers: [], mcpServers: [], skills: [], prompts: [] }
    try {
      out.providers = db.prepare('SELECT id, app_type, name, settings_config FROM providers').all() ?? []
    } catch { /* table may not exist */ }
    try {
      out.mcpServers = db.prepare('SELECT id, name, server_config, enabled_claude, enabled_codex, enabled_gemini FROM mcp_servers').all() ?? []
    } catch { /* ignore */ }
    try {
      out.skills = db.prepare('SELECT id, name, directory, enabled_claude, enabled_codex FROM skills').all() ?? []
    } catch { /* ignore */ }
    try {
      out.prompts = db.prepare("SELECT id, app_type, name, length(content) AS chars FROM prompts").all() ?? []
    } catch { /* ignore */ }
    db.close()
    return out
  } catch (e) {
    return { error: String(e) }
  }
}

function cat(supported, available, count, note) {
  return { supported, available, count: count ?? 0, note }
}

/**
 * 能力级检测：两级证据，全自动、不要求对方插件任何配合。
 * 1. 工具注册表（硬证据）：dsh 里“能干活”的插件必须 ctx.tools.register() 注册工具，
 *    工具名/描述是作者自己写的功能声明，命中即可确信（如 dsh-cc-switch 的 ccswitch_sync）。
 * 2. 插件名正则（软猜测）：只按插件 id 猜，措辞必须标“未确认”。
 * 都没命中就如实说“未检测到”，不编造名字。
 */
const CAPABILITY_PATTERNS = {
  // 工具证据要求“能力词 + 动作词”同时出现（如 "Sync provider profiles … routes"），
  // 单个 provider 单词太泛——skill_manager_list 的描述里也有 provider，曾误伤。
  // 动作词带词边界：否则 "asynchronous" 里的 sync 也会命中（firecrawl_agent 曾误伤 prompts）。
  providers: {
    tool: /ccswitch|(?=.*provider)(?=.*\b(sync|routes?|switch\w*)\b)/i,
    name: /cc[._-]?switch|provider/i,
  },
  memory: {
    tool: /memory|claude[._-]?bridge/i,
    name: /memory|claude[._-]?bridge/i,
  },
  // 会话导入需显式含 import/move/sync 语义，避免命中 dsh 核心的会话管理插件/工具
  sessions: {
    tool: /claude[._-]?move|chat[._-]?import|session[._-]?(import|move|sync)/i,
    name: /claude[._-]?move|chat[._-]?import|session[._-]?(import|move|sync)/i,
  },
  prompts: {
    tool: /(?=.*prompt)(?=.*\b(import|sync|migrat\w*|move)\b)/i,
    name: /prompt[._-]?(import|sync|migrat)/i,
  },
}

/**
 * 归一化能力证据入参：兼容旧签名（纯插件名数组）与新签名（{names, tools}）。
 * @param evidence 插件名数组，或 { names: string[], tools: [{name, description}] }
 * @returns {{ names: string[], tools: Array<{name: string, description: string}> }}
 */
function normalizeEvidence(evidence) {
  if (Array.isArray(evidence)) return { names: evidence, tools: [] }
  return {
    names: Array.isArray(evidence?.names) ? evidence.names : [],
    tools: Array.isArray(evidence?.tools) ? evidence.tools : [],
  }
}

/**
 * 匹配某能力的处理者。先查工具注册表（工具名 + 描述），再退到插件名猜测。
 * @returns {null | {kind: 'tool'|'guess', name: string}} kind=tool 是确证，guess 是猜测
 */
export function capabilityMatch(evidence, capability) {
  const patterns = CAPABILITY_PATTERNS[capability]
  if (!patterns) return null
  const { names, tools } = normalizeEvidence(evidence)
  const toolHit = tools.find((t) => t && patterns.tool.test(`${t.name} ${t.description ?? ''}`))
  if (toolHit) return { kind: 'tool', name: toolHit.name }
  const nameHit = names.find((n) => patterns.name.test(n))
  // entry id 带 cordis 层级前缀（如 include:cc-switch），展示时剥掉
  if (nameHit) return { kind: 'guess', name: nameHit.replace(/^include:/, '') }
  return null
}

/**
 * 已认识的委派工具：知道如何构造参数、以及该插件的默认行为注解。
 * 不认识但命中能力的工具只提示、不调用——参数语义未知，不能瞎调。
 * args(dryRun) 与导入弹窗的预演/正式两阶段对应：预演传 true，正式传 false。
 */
export const KNOWN_TOOL_ACTIONS = {
  ccswitch_sync: {
    capability: 'providers',
    args: (dryRun) => ({ dryRun }),
    // 注解保持工具无关：不说来源名/插件名（行内已显示工具名，来源名行外可见），
    // 用户换任何同步插件这句话都成立
    note: '该插件默认在 DSH 启动时自动同步；勾选后导入时手动触发一次（想立即生效、免重启时用）',
  },
}

/**
 * 能力类别行（不可直接导入、由外部插件处理的类别）：生成 {supported:false, ..., note, delegate?}。
 * delegate = 命中工具名时带上，宿主据此在导入时程序化调用该工具。
 */
function capCat(capability, evidence, count) {
  const hit = capabilityMatch(evidence, capability)
  const known = hit?.kind === 'tool' ? KNOWN_TOOL_ACTIONS[hit.name] : null
  let note
  if (hit?.kind === 'tool') note = `由已注册工具「${hit.name}」处理` + (known ? `；${known.note}` : '')
  else if (hit?.kind === 'guess') note = `检测到可能相关的插件「${hit.name}」，未确认`
  else note = '未检测到处理该能力的插件，本插件不导入此项'
  const c = cat(false, false, count, note)
  if (hit?.kind === 'tool') c.delegate = hit.name
  return c
}

/** 扫描全部来源。返回 { id, name, basePath, found, categories } 数组。
 *  @param evidence 可选：能力检测证据——插件名数组（旧签名）或 { names, tools }（tools 为工具 schema 列表）。
 *  @param opts 可选：{ roots: 来源根目录覆盖, ccSwitchDb: cc-switch.db 路径 }。 */
export function detectSources(evidence = [], opts = {}) {
  const roots = resolveRoots(opts.roots)
  const claudeRoot = roots['claude-code']
  const cursorRoot = roots.cursor
  const codexRoot = roots.codex
  const ccRoot = roots['cc-switch']

  const sources = [
    {
      id: 'claude-code', name: 'Claude Code', basePath: claudeRoot, found: existsSync(claudeRoot),
      categories: {
        mcp: cat(true, countMcpFromFile(join(claudeRoot, 'mcp.json')) > 0, countMcpFromFile(join(claudeRoot, 'mcp.json'))),
        skills: cat(true, countSkillDirs(join(claudeRoot, 'skills')) > 0, countSkillDirs(join(claudeRoot, 'skills'))),
        instructions: cat(false, false, existsSync(join(claudeRoot, 'CLAUDE.md')) ? 1 : 0, 'DSH 启动时自动读取 CLAUDE.md，无需导入'),
        memory: capCat('memory', evidence, countMemoryFiles(claudeRoot)),
        sessions: capCat('sessions', evidence, 0),
      },
    },
    {
      id: 'cursor', name: 'Cursor', basePath: cursorRoot, found: existsSync(cursorRoot),
      categories: {
        mcp: cat(true, countMcpFromFile(join(cursorRoot, 'mcp.json')) > 0, countMcpFromFile(join(cursorRoot, 'mcp.json'))),
        skills: cat(true, countSkillDirs(join(cursorRoot, 'skills')) > 0, countSkillDirs(join(cursorRoot, 'skills'))),
        instructions: cat(false, false, 0, '暂不支持'),
        memory: capCat('memory', evidence, 0),
        sessions: capCat('sessions', evidence, 0),
      },
    },
    {
      id: 'codex', name: 'Codex', basePath: codexRoot, found: existsSync(codexRoot),
      categories: {
        mcp: cat(true, countMcpFromFile(join(codexRoot, 'config.toml')) > 0, countMcpFromFile(join(codexRoot, 'config.toml'))),
        skills: cat(true, countSkillDirs(join(codexRoot, 'skills')) > 0, countSkillDirs(join(codexRoot, 'skills'))),
        instructions: cat(false, false, existsSync(join(codexRoot, 'AGENTS.md')) ? 1 : 0, 'DSH 启动时自动读取 AGENTS.md，无需导入'),
        memory: capCat('memory', evidence, 0),
        sessions: capCat('sessions', evidence, 0),
      },
    },
    {
      id: 'cc-switch', name: 'cc-switch', basePath: ccRoot, found: existsSync(ccRoot),
      categories: {
        providers: capCat('providers', evidence, 0),
        mcp: cat(true, false, 0),
        skills: cat(true, countSkillDirs(join(ccRoot, 'skills')) > 0, countSkillDirs(join(ccRoot, 'skills'))),
        prompts: capCat('prompts', evidence, 0),
        memory: capCat('memory', evidence, 0),
        sessions: capCat('sessions', evidence, 0),
      },
    },
  ]

  // cc-switch 的 mcp/providers/prompts 来自 db（懒读一次）
  const db = readCcSwitchDb(opts.ccSwitchDb)
  if (db && !db.error) {
    const cc = sources.find((s) => s.id === 'cc-switch')
    const enabledCount = (rows, col) => (rows ?? []).filter((r) => r[col]).length
    cc.categories.mcp = cat(true, (db.mcpServers ?? []).length > 0, (db.mcpServers ?? []).length)
    // 模型路由 / 提示词：只检测计数，不导入（由具备对应能力的插件处理，非本插件职责）
    cc.categories.providers = capCat('providers', evidence, (db.providers ?? []).length)
    cc.categories.prompts = capCat('prompts', evidence, (db.prompts ?? []).length)
  }
  return sources
}

// ── 落点：官方组合层 cordis.patch.yml ──────────────────────────────────
export function profilePatchPath(profile = 'web') {
  return join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml')
}

/** 给用户选择的 MCP 落点选项（id 对应 config.target / run 请求体的 target）。
 *  落点不能是任意路径：组合层必须写进 profile 的 cordis.patch.yml 才会被 dsh 加载，
 *  mcp.json 必须在 ~/.dsh 下才会被读——所以选项只在对应位置真实存在时提供。
 *  mcp.json 不存在时只有组合层一个合法落点，此时返回单选项，前端不渲染选择器。 */
export function targetOptions(profile = 'web') {
  const real = [{ id: 'patch', label: '组合层（cordis.patch.yml）', path: profilePatchPath(profile) }]
  const mcpJson = join(DSH_HOME, 'mcp.json')
  if (existsSync(mcpJson)) real.push({ id: 'mcp-json', label: 'mcp.json', path: mcpJson })
  // 有第二个合法落点时，“自动选择”才有意义
  if (real.length > 1) real.unshift({ id: 'auto', label: '自动选择', path: '' })
  return real
}

/** 从组合层文档的一行（layer 或 insert 行）里收集 id 与 serverName。 */
function collectRowMeta(row, ids, names) {
  if (!row || typeof row !== 'object') return
  if (typeof row.id === 'string') ids.add(row.id)
  const serverName = row.config?.serverName
  if (typeof serverName === 'string') names.add(serverName)
}

/** 结构化解析组合层 patch（YAML 数组），提取已占用的 serverName 与行 id。
 *  文件存在但解析失败时抛错——组合层损坏是响亮事件，不静默当空文件处理。 */
export function existingServerNamesInPatch(profile = 'web') {
  const path = profilePatchPath(profile)
  if (!existsSync(path)) return { path, names: new Set(), ids: new Set() }
  const text = readFileSync(path, 'utf8')
  let doc
  try { doc = parseYaml(text) } catch (e) { throw new Error(`组合层 YAML 解析失败（${path}）：${e.message}`) }
  const names = new Set()
  const ids = new Set()
  for (const layer of Array.isArray(doc) ? doc : []) {
    collectRowMeta(layer, ids, names)
    for (const row of Array.isArray(layer?.insert) ? layer.insert : []) collectRowMeta(row, ids, names)
  }
  return { path, names, ids }
}

/** 服务器定义 → 组合层行对象（id 冲突自动加序号）。 */
function serverToPatchRow(server, usedIds) {
  const id = `mcp-${server.name}`
  let uniqueId = id
  let n = 2
  while (usedIds.has(uniqueId)) uniqueId = `${id}-${n++}`
  usedIds.add(uniqueId)
  const config = { serverName: server.name, transport: server.transport }
  if (server.transport === 'stdio') {
    config.command = server.command
    if (server.args?.length) config.args = server.args
    if (server.env && Object.keys(server.env).length) config.env = server.env
    if (server.cwd) config.cwd = server.cwd
  } else {
    config.url = server.url
    if (server.headers && Object.keys(server.headers).length) config.headers = server.headers
  }
  return { id: uniqueId, name: '@deepseek-ai/dsh-mcp-client', config }
}

/** 组合层备份保留份数，超出后从最旧的开始清理。 */
const MAX_PATCH_BACKUPS = 5

/** 写入前滚动备份：`<file>.bak-<时间戳>`，只留最近 MAX_PATCH_BACKUPS 份。 */
function backupRolling(path) {
  if (!existsSync(path)) return
  copyFileSync(path, `${path}.bak-${Date.now()}`)
  const dir = dirname(path)
  const prefix = basename(path) + '.bak-'
  const stale = readdirSync(dir).filter((f) => f.startsWith(prefix)).sort()
  while (stale.length > MAX_PATCH_BACKUPS) rmSync(join(dir, stale.shift()))
}

/** 把服务器列表追加进官方组合层（默认跳过同名；dryRun 只预览）。
 *  读：结构化 YAML 解析；写：保留既有内容原样（含注释），仅追加 yaml 库序列化的新 layer，
 *  经 dsh-atomic-write 原子替换，崩溃不会留半个文件。 */
export async function importMcpToPatch(servers, { profile = 'web', dryRun = false } = {}) {
  const { path, names, ids } = existingServerNamesInPatch(profile)
  const usedIds = new Set(ids)
  const toAdd = []
  const skipped = []
  for (const s of servers) {
    if (!NAME_RE.test(s.name)) { skipped.push({ name: s.name, reason: '非法名称' }); continue }
    if (names.has(s.name)) { skipped.push({ name: s.name, reason: '已在组合层中存在（同名）' }); continue }
    toAdd.push(s)
  }
  if (!toAdd.length) return { added: [], skipped, target: path, dryRun }
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const layer = { insert: toAdd.map((s) => serverToPatchRow(s, usedIds)) }
  const block = `\n# --- dsh-inherit 导入 ${stamp} ---\n` + stringifyYaml([layer])
  if (!dryRun) {
    backupRolling(path)
    const prev = existsSync(path) ? readFileSync(path, 'utf8').replace(/\s*$/, '') : ''
    await writeFileAtomic(path, prev + block, { mode: 0o600, dirMode: 0o700 })
  }
  return { added: toAdd.map((s) => s.name), skipped, target: path, dryRun }
}

// ── Skills 导入：复制目录到 ~/.dsh/skills ──────────────────────────────
export function importSkillsToDsh(sourceDirs, { dryRun = false } = {}) {
  const targetRoot = join(DSH_HOME, 'skills')
  const copied = []
  const skipped = []
  for (const dir of sourceDirs) {
    const name = dir.split(/[\\/]/).filter(Boolean).pop()
    if (!name) continue
    if (existsSync(join(targetRoot, name))) { skipped.push({ name, reason: '已在 ~/.dsh/skills 中存在' }); continue }
    copied.push(name)
    if (!dryRun) {
      mkdirSync(targetRoot, { recursive: true })
      cpSync(dir, join(targetRoot, name), { recursive: true })
    }
  }
  return { copied, skipped, target: targetRoot, dryRun }
}

// ── 按来源取 MCP 服务器列表 ────────────────────────────────────────────
/** @param opts 可选：{ roots, ccSwitchDb }（同 detectSources）。 */
export function collectServersFromSource(sourceId, opts = {}) {
  const roots = resolveRoots(opts.roots)
  const paths = {
    'claude-code': join(roots['claude-code'], 'mcp.json'),
    'cursor': join(roots.cursor, 'mcp.json'),
    'codex': join(roots.codex, 'config.toml'),
  }
  if (sourceId === 'cc-switch') {
    const db = readCcSwitchDb(opts.ccSwitchDb)
    if (!db || db.error) return { servers: [], error: db?.error }
    const servers = []
    for (const row of db.mcpServers ?? []) {
      let cfg = null
      try { cfg = typeof row.server_config === 'string' ? JSON.parse(row.server_config) : row.server_config } catch { /* ignore */ }
      if (!cfg || typeof cfg !== 'object') continue
      const conv = toDshServer(row.name ?? row.id, cfg)
      if (conv.ok) servers.push(conv.server)
    }
    return { servers }
  }
  const path = paths[sourceId]
  if (!path || !existsSync(path)) return { servers: [] }
  const doc = readJson(path, true)
  if (doc) {
    const entries = extractFromJson(doc)
    if (entries) {
      const servers = []
      for (const { name, config } of entries) {
        const conv = toDshServer(name, config)
        if (conv.ok) servers.push(conv.server)
      }
      return { servers }
    }
  }
  const toml = extractFromCodexToml(path)
  if (toml) {
    const servers = []
    for (const { name, config } of toml) {
      const conv = toDshServer(name, config)
      if (conv.ok) servers.push(conv.server)
    }
    return { servers }
  }
  return { servers: [] }
}

/** @param opts 可选：{ roots }（同 detectSources）。 */
export function collectSkillDirsFromSource(sourceId, opts = {}) {
  const roots = resolveRoots(opts.roots)
  const dirs = []
  const root = roots[sourceId] ? join(roots[sourceId], 'skills') : undefined
  if (!root || !existsSync(root)) return []
  try {
    for (const entry of readdirSync(root)) {
      const p = join(root, entry)
      if (statSync(p).isDirectory() && (existsSync(join(p, 'SKILL.md')) || existsSync(join(p, 'skill.md')))) dirs.push(p)
    }
  } catch { /* ignore */ }
  return dirs
}

// ── 执行导入 ────────────────────────────────────────────────────────────
/**
 * @param selections [{source, categories: string[]}] 勾选结果
 * @param opts {target: 'auto'|'patch'|'mcp-json', dryRun, profile, roots, ccSwitchDb}
 */
export async function runImport(selections, opts = {}) {
  const { target = 'auto', dryRun = false } = opts
  const report = { mcp: { imported: [], skipped: [] }, skills: { imported: [], skipped: [] }, notes: [], dryRun }

  // 全量扫描快照取一次，避免循环内重复读盘/sqlite
  const snapshot = detectSources([], opts)

  const allServers = []
  const seenNames = new Set()
  for (const sel of selections) {
    if (sel.categories.includes('mcp')) {
      const { servers, error } = collectServersFromSource(sel.source, opts)
      if (error) report.notes.push(`${sel.source}: cc-switch db 读取失败 — ${error}`)
      for (const s of servers) {
        if (seenNames.has(s.name)) continue
        seenNames.add(s.name)
        allServers.push(s)
      }
    }
    if (sel.categories.includes('skills')) {
      const dirs = collectSkillDirsFromSource(sel.source, opts)
      const r = importSkillsToDsh(dirs, { dryRun })
      report.skills.imported.push(...r.copied.map((n) => `${sel.source}: ${n}`))
      report.skills.skipped.push(...r.skipped.map((x) => `${sel.source}: ${x.name}（${x.reason}）`))
    }
    const srcCats = snapshot.find((s) => s.id === sel.source)?.categories ?? {}
    for (const c of sel.categories) {
      const info = srcCats[c]
      if (info && !info.supported && info.note) report.notes.push(`${sel.source} · ${c}: ${info.note}`)
    }
  }

  if (allServers.length) {
    let resolvedTarget = target
    // auto = 自动探测落点；给用户的说明直接展示最终写入路径，不提内部代号
    const autoSuffix = resolvedTarget === 'auto' ? '（自动选择）' : ''
    if (resolvedTarget === 'auto') {
      resolvedTarget = existsSync(join(DSH_HOME, 'mcp.json')) ? 'mcp-json' : 'patch'
    }
    if (resolvedTarget === 'patch') {
      const r = await importMcpToPatch(allServers, { dryRun, profile: opts.profile ?? 'web' })
      report.mcp.imported.push(...r.added)
      report.mcp.skipped.push(...r.skipped.map((x) => `${x.name}（${x.reason}）`))
      report.mcp.target = r.target
      report.notes.push(`MCP 写入位置：${r.target}${autoSuffix}`)
    } else if (resolvedTarget === 'mcp-json') {
      const path = join(DSH_HOME, 'mcp.json')
      const existing = readJson(path, true)
      const byName = new Map((existing?.servers ?? []).map((s) => [s.name, s]))
      for (const s of allServers) {
        if (byName.has(s.name)) { report.mcp.skipped.push(`${s.name}（已在 mcp.json 中）`); continue }
        byName.set(s.name, s)
        report.mcp.imported.push(s.name)
      }
      if (!dryRun) {
        await writeFileAtomic(path, JSON.stringify({ servers: [...byName.values()] }, null, 2) + '\n', { mode: 0o600, dirMode: 0o700 })
      }
      report.mcp.target = path
      report.notes.push(`MCP 写入位置：${path}${autoSuffix}`)
    }
  }
  return report
}
