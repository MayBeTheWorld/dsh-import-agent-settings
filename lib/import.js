/**
 * lib/import.js — 导入智能体设置 · 纯业务逻辑（无 DSH 运行时依赖，可独立冒烟测试）
 *
 * 来源检测 + 类别盘点 + MCP/Skills 导入管线。落点默认是官方组合层
 * cordis.patch.yml（无插件/Hanihahaha UI/官方版通用）；zebbkira 版 UI 的
 * ~/.dsh/mcp.json 作为可选落点（auto 检测）。
 */
import {
  existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync,
  cpSync, readdirSync, statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

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
    return Object.entries(doc.mcpServers).filter(([, c]) => c && typeof c === 'object')
      .map(([n, c]) => ({ name: n, config: c }))
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

/** 读取 cc-switch.db（node:sqlite，实验特性；失败返回 null）。 */
export function readCcSwitchDb() {
  const dbPath = process.env.CC_SWITCH_DB || join(homedir(), '.cc-switch', 'cc-switch.db')
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
 * 能力级检测（不依赖具体插件名）：按能力关键词匹配“实际加载的插件”。
 * 社区插件同功能不同名也能命中；没命中就如实说“未检测到”，不编造名字。
 */
const CAPABILITY_PATTERNS = {
  providers: /cc[._-]?switch|provider/i,
  memory: /memory|claude[._-]?bridge/i,
  sessions: /claude[._-]?move|session/i,
}

export function capabilityMatch(loadedNames, capability) {
  const re = CAPABILITY_PATTERNS[capability]
  if (!re || !Array.isArray(loadedNames)) return null
  const hit = loadedNames.find((n) => re.test(n))
  return hit || null
}

function capabilityNote(capability, loadedNames, what) {
  const hit = capabilityMatch(loadedNames, capability)
  if (hit) return `${what}由已加载插件「${hit}」处理`
  return `${what}未检测到处理该能力的插件；本插件不导入此项`
}

/** 扫描全部来源。返回 { id, name, basePath, found, categories } 数组。
 *  @param loadedNames 可选：当前实际加载的插件名列表（能力级检测用）。 */
export function detectSources(loadedNames = []) {
  const claudeRoot = join(homedir(), '.claude')
  const cursorRoot = join(homedir(), '.cursor')
  const codexRoot = join(homedir(), '.codex')
  const ccRoot = join(homedir(), '.cc-switch')

  const sources = [
    {
      id: 'claude-code', name: 'Claude Code', basePath: claudeRoot, found: existsSync(claudeRoot),
      categories: {
        mcp: cat(true, countMcpFromFile(join(claudeRoot, 'mcp.json')) > 0, countMcpFromFile(join(claudeRoot, 'mcp.json'))),
        skills: cat(true, countSkillDirs(join(claudeRoot, 'skills')) > 0, countSkillDirs(join(claudeRoot, 'skills'))),
        instructions: cat(true, existsSync(join(claudeRoot, 'CLAUDE.md')), existsSync(join(claudeRoot, 'CLAUDE.md')) ? 1 : 0, 'DSH 原生自动读取 CLAUDE.md，无需导入'),
        memory: cat(false, false, countMemoryFiles(claudeRoot), capabilityNote('memory', loadedNames, '记忆：')),
        sessions: cat(false, false, 0, capabilityNote('sessions', loadedNames, '会话：')),
      },
    },
    {
      id: 'cursor', name: 'Cursor', basePath: cursorRoot, found: existsSync(cursorRoot),
      categories: {
        mcp: cat(true, countMcpFromFile(join(cursorRoot, 'mcp.json')) > 0, countMcpFromFile(join(cursorRoot, 'mcp.json'))),
        skills: cat(true, countSkillDirs(join(cursorRoot, 'skills')) > 0, countSkillDirs(join(cursorRoot, 'skills'))),
        instructions: cat(false, false, 0, '暂不支持'),
        memory: cat(false, false, 0, '暂不支持'),
        sessions: cat(false, false, 0, '暂不支持'),
      },
    },
    {
      id: 'codex', name: 'Codex', basePath: codexRoot, found: existsSync(codexRoot),
      categories: {
        mcp: cat(true, countMcpFromFile(join(codexRoot, 'config.toml')) > 0, countMcpFromFile(join(codexRoot, 'config.toml'))),
        skills: cat(true, countSkillDirs(join(codexRoot, 'skills')) > 0, countSkillDirs(join(codexRoot, 'skills'))),
        instructions: cat(true, existsSync(join(codexRoot, 'AGENTS.md')), existsSync(join(codexRoot, 'AGENTS.md')) ? 1 : 0, 'DSH 原生自动读取 AGENTS.md，无需导入'),
        memory: cat(false, false, 0, '暂不支持'),
        sessions: cat(false, false, 0, '暂不支持'),
      },
    },
    {
      id: 'cc-switch', name: 'cc-switch', basePath: ccRoot, found: existsSync(ccRoot),
      categories: {
        providers: cat(false, false, 0, capabilityNote('providers', loadedNames, '模型路由：')),
        mcp: cat(true, false, 0),
        skills: cat(true, countSkillDirs(join(ccRoot, 'skills')) > 0, countSkillDirs(join(ccRoot, 'skills'))),
        prompts: cat(false, false, 0, '暂不支持'),
        memory: cat(false, false, 0, '暂不支持'),
        sessions: cat(false, false, 0, '暂不支持'),
      },
    },
  ]

  // cc-switch 的 mcp/providers/prompts 来自 db（懒读一次）
  const db = readCcSwitchDb()
  if (db && !db.error) {
    const cc = sources.find((s) => s.id === 'cc-switch')
    const enabledCount = (rows, col) => (rows ?? []).filter((r) => r[col]).length
    cc.categories.mcp = cat(true, (db.mcpServers ?? []).length > 0, (db.mcpServers ?? []).length)
    // 模型路由 / 提示词：只检测计数，不导入（需 LLM 适配插件注册 route + 命名空间，非本插件职责）
    cc.categories.providers = cat(false, false, (db.providers ?? []).length, capabilityNote('providers', loadedNames, '模型路由：'))
    cc.categories.prompts = cat(false, false, (db.prompts ?? []).length, '提示词：暂不支持')
  }
  return sources
}

// ── 落点：官方组合层 cordis.patch.yml ──────────────────────────────────
export function profilePatchPath(profile = 'web') {
  return join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml')
}

function yamlStr(v) {
  const s = String(v)
  if (s === '') return "''"
  return `'${s.replace(/'/g, "''")}'`
}

export function existingServerNamesInPatch(profile = 'web') {
  const path = profilePatchPath(profile)
  if (!existsSync(path)) return { path, names: new Set(), ids: new Set() }
  const text = readFileSync(path, 'utf8')
  const names = new Set()
  for (const m of text.matchAll(/serverName:\s*['"]?([A-Za-z0-9_-]+)['"]?/g)) names.add(m[1])
  const ids = new Set()
  for (const m of text.matchAll(/^\s*- id:\s*([A-Za-z0-9_-]+)\s*$/gm)) ids.add(m[1])
  return { path, names, ids }
}

function serverToPatchRows(server, usedIds) {
  const id = `mcp-${server.name}`
  let uniqueId = id
  let n = 2
  while (usedIds.has(uniqueId)) uniqueId = `${id}-${n++}`
  usedIds.add(uniqueId)
  const rows = [
    `    - id: ${uniqueId}`,
    `      name: '@deepseek-ai/dsh-mcp-client'`,
    '      config:',
    `        serverName: ${yamlStr(server.name)}`,
    `        transport: ${yamlStr(server.transport)}`,
  ]
  if (server.transport === 'stdio') {
    rows.push(`        command: ${yamlStr(server.command)}`)
    if (server.args?.length) { rows.push('        args:'); for (const a of server.args) rows.push(`          - ${yamlStr(a)}`) }
    if (server.env && Object.keys(server.env).length) { rows.push('        env:'); for (const [k, v] of Object.entries(server.env)) rows.push(`          ${yamlStr(k)}: ${yamlStr(v)}`) }
    if (server.cwd) rows.push(`        cwd: ${yamlStr(server.cwd)}`)
  } else {
    rows.push(`        url: ${yamlStr(server.url)}`)
    if (server.headers && Object.keys(server.headers).length) { rows.push('        headers:'); for (const [k, v] of Object.entries(server.headers)) rows.push(`          ${yamlStr(k)}: ${yamlStr(v)}`) }
  }
  return rows
}

/** 把服务器列表追加进官方组合层（默认跳过同名；dryRun 只预览）。 */
export function importMcpToPatch(servers, { profile = 'web', dryRun = false } = {}) {
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
  const block = ['', `# --- dsh-import-agent-settings 导入 ${stamp} ---`, '- insert:']
  for (const s of toAdd) block.push(...serverToPatchRows(s, usedIds))
  const text = block.join('\n') + '\n'
  if (!dryRun) {
    if (existsSync(path)) copyFileSync(path, `${path}.bak-${Date.now()}`)
    else mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\s*$/, '') + text, 'utf8')
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
export function collectServersFromSource(sourceId) {
  const home = homedir()
  const paths = {
    'claude-code': join(home, '.claude', 'mcp.json'),
    'cursor': join(home, '.cursor', 'mcp.json'),
    'codex': join(home, '.codex', 'config.toml'),
  }
  if (sourceId === 'cc-switch') {
    const db = readCcSwitchDb()
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

export function collectSkillDirsFromSource(sourceId) {
  const home = homedir()
  const roots = {
    'claude-code': join(home, '.claude', 'skills'),
    'cursor': join(home, '.cursor', 'skills'),
    'codex': join(home, '.codex', 'skills'),
    'cc-switch': join(home, '.cc-switch', 'skills'),
  }
  const root = roots[sourceId]
  if (!root || !existsSync(root)) return []
  const dirs = []
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
 * @param opts {target: 'auto'|'patch'|'mcp-json', dryRun}
 */
export function runImport(selections, opts = {}) {
  const { target = 'auto', dryRun = false } = opts
  const report = { mcp: { imported: [], skipped: [] }, skills: { imported: [], skipped: [] }, notes: [], dryRun }

  const allServers = []
  const seenNames = new Set()
  for (const sel of selections) {
    if (sel.categories.includes('mcp')) {
      const { servers, error } = collectServersFromSource(sel.source)
      if (error) report.notes.push(`${sel.source}: cc-switch db 读取失败 — ${error}`)
      for (const s of servers) {
        if (seenNames.has(s.name)) continue
        seenNames.add(s.name)
        allServers.push(s)
      }
    }
    if (sel.categories.includes('skills')) {
      const dirs = collectSkillDirsFromSource(sel.source)
      const r = importSkillsToDsh(dirs, { dryRun })
      report.skills.imported.push(...r.copied.map((n) => `${sel.source}: ${n}`))
      report.skills.skipped.push(...r.skipped.map((x) => `${sel.source}: ${x.name}（${x.reason}）`))
    }
    const srcCats = detectSources().find((s) => s.id === sel.source)?.categories ?? {}
    for (const c of sel.categories) {
      const info = srcCats[c]
      if (info && !info.supported && info.note) report.notes.push(`${sel.source} · ${c}: ${info.note}`)
    }
  }

  if (allServers.length) {
    let resolvedTarget = target
    if (resolvedTarget === 'auto') {
      resolvedTarget = existsSync(join(DSH_HOME, 'mcp.json')) ? 'mcp-json' : 'patch'
      report.notes.push(`落点 auto → ${resolvedTarget}`)
    }
    if (resolvedTarget === 'patch') {
      const r = importMcpToPatch(allServers, { dryRun })
      report.mcp.imported.push(...r.added)
      report.mcp.skipped.push(...r.skipped.map((x) => `${x.name}（${x.reason}）`))
      report.mcp.target = r.target
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
        mkdirSync(DSH_HOME, { recursive: true })
        writeFileSync(path, JSON.stringify({ servers: [...byName.values()] }, null, 2) + '\n', 'utf8')
      }
      report.mcp.target = path
    }
  }
  return report
}
