/**
 * import.js 冒烟测试（node:test，无第三方依赖）。
 * 运行：npm test（= node --test）。
 * 涉及文件写入的用例一律落在临时目录；DSH_HOME 在动态导入前覆盖，
 * 因为 lib/import.js 的 DSH_HOME 是模块加载时读取的快照。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

import {
  extractFromJson, toDshServer, capabilityMatch, KNOWN_TOOL_ACTIONS,
} from '../lib/import.js'

/** 造一个临时目录，返回路径。 */
function tmp() {
  return mkdtempSync(join(tmpdir(), 'dsh-inherit-test-'))
}

// ── extractFromJson ─────────────────────────────────────────────────────
test('extractFromJson: mcpServers 对象形式', () => {
  const out = extractFromJson({ mcpServers: { tavily: { command: 'npx' }, fs: { command: 'node' } } })
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((e) => e.name).sort(), ['fs', 'tavily'])
})

test('extractFromJson: DSH servers 数组形式', () => {
  const out = extractFromJson({ servers: [{ name: 'a', url: 'http://x' }, { bad: true }] })
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'a')
})

test('extractFromJson: 非法输入返回 null', () => {
  assert.equal(extractFromJson(null), null)
  assert.equal(extractFromJson({}), null)
  assert.equal(extractFromJson({ mcpServers: {} }), null)
})

// ── toDshServer ─────────────────────────────────────────────────────────
test('toDshServer: stdio 正常转换', () => {
  const r = toDshServer('fs', { type: 'stdio', command: 'node', args: ['srv.js'], env: { A: '1' } })
  assert.equal(r.ok, true)
  assert.equal(r.server.transport, 'stdio')
  assert.deepEqual(r.server.args, ['srv.js'])
})

test('toDshServer: stdio 缺 command 报错', () => {
  assert.equal(toDshServer('x', { type: 'stdio' }).ok, false)
})

test('toDshServer: http 归一为 streamable-http', () => {
  const r = toDshServer('web', { type: 'http', url: 'http://localhost:8000/mcp' })
  assert.equal(r.ok, true)
  assert.equal(r.server.transport, 'streamable-http')
})

test('toDshServer: 不支持的类型报错且不崩溃', () => {
  const r = toDshServer('old', { type: 'sse', url: 'http://x' })
  assert.equal(r.ok, false)
  assert.match(r.reason, /不支持/)
})

// ── capabilityMatch（两级证据 + 词边界防误伤）─────────────────────────
const CCSWITCH = { name: 'ccswitch_sync', description: 'Sync provider profiles into Harness model routes' }

test('capabilityMatch: 工具注册表命中（硬证据优先）', () => {
  const hit = capabilityMatch({ names: ['some-other-plugin'], tools: [CCSWITCH] }, 'providers')
  assert.deepEqual(hit, { kind: 'tool', name: 'ccswitch_sync' })
})

test('capabilityMatch: 无工具时退到插件名猜测，剥 include: 前缀', () => {
  const hit = capabilityMatch({ names: ['include:cc-switch'], tools: [] }, 'providers')
  assert.deepEqual(hit, { kind: 'guess', name: 'cc-switch' })
})

test('capabilityMatch: 旧签名（纯数组）兼容', () => {
  assert.deepEqual(capabilityMatch(['cc-switch'], 'providers'), { kind: 'guess', name: 'cc-switch' })
})

test('capabilityMatch: 全不命中返回 null', () => {
  assert.equal(capabilityMatch({ names: [], tools: [] }, 'providers'), null)
})

test('capabilityMatch: 防误伤——描述含 provider 但无动作词不命中', () => {
  const tools = [{ name: 'skill_manager_list', description: 'List skills: name, source root, provider, and invocation policy' }]
  assert.equal(capabilityMatch({ names: [], tools }, 'providers'), null)
})

test('capabilityMatch: 防误伤——asynchronous 里的 sync 不命中（词边界）', () => {
  const tools = [{ name: 'firecrawl_agent', description: 'Start an asynchronous web research job from a prompt' }]
  assert.equal(capabilityMatch({ names: [], tools }, 'prompts'), null)
  assert.equal(capabilityMatch({ names: [], tools }, 'providers'), null)
})

test('capabilityMatch: 核心会话工具不误中 sessions', () => {
  const tools = [{ name: 'session_query', description: 'Query session history' }]
  assert.equal(capabilityMatch({ names: ['session'], tools }, 'sessions'), null)
})

test('KNOWN_TOOL_ACTIONS: ccswitch_sync 的参数构造与能力映射', () => {
  const a = KNOWN_TOOL_ACTIONS.ccswitch_sync
  assert.equal(a.capability, 'providers')
  assert.deepEqual(a.args(true), { dryRun: true })
  assert.deepEqual(a.args(false), { dryRun: false })
})

// ── 文件级用例（临时目录 + DSH_HOME 快照覆盖）─────────────────────────
const dshHome = tmp()
process.env.DSH_HOME = dshHome
const { detectSources, runImport, importMcpToPatch, existingServerNamesInPatch, targetOptions } =
  await import('../lib/import.js?dsb-home-override')

/** 造一个 Claude Code 来源 fixture：mcp.json 两条 + skills 两个。 */
function makeClaudeRoot() {
  const root = tmp()
  writeFileSync(join(root, 'mcp.json'), JSON.stringify({
    mcpServers: {
      tavily: { type: 'stdio', command: 'npx', args: ['-y', 'tavily-mcp'] },
      web: { type: 'http', url: 'http://localhost:8000/mcp' },
    },
  }))
  for (const s of ['alpha', 'beta']) {
    mkdirSync(join(root, 'skills', s), { recursive: true })
    writeFileSync(join(root, 'skills', s, 'SKILL.md'), '# x')
  }
  mkdirSync(join(root, 'skills', 'not-a-skill'), { recursive: true }) // 无 SKILL.md，不计数
  return root
}

test('detectSources: fixture 计数与类别状态', () => {
  const root = makeClaudeRoot()
  const sources = detectSources({ names: [], tools: [CCSWITCH] }, { roots: { 'claude-code': root }, ccSwitchDb: join(tmp(), 'nope.db') })
  const cc = sources.find((s) => s.id === 'claude-code')
  assert.equal(cc.found, true)
  assert.equal(cc.categories.mcp.count, 2)
  assert.equal(cc.categories.skills.count, 2)
  // 能力类别带 delegate（工具命中）
  const providers = sources.find((s) => s.id === 'cc-switch').categories.providers
  assert.equal(providers.delegate, 'ccswitch_sync')
  assert.match(providers.note, /ccswitch_sync/)
})

test('importMcpToPatch: 写入组合层并可解析回读；同名二次导入跳过', async () => {
  const servers = [
    { name: 'tavily', transport: 'stdio', enabled: true, command: 'npx', args: ['-y', 'tavily-mcp'], env: {}, cwd: '' },
    { name: 'web', transport: 'streamable-http', enabled: true, url: 'http://localhost:8000/mcp', headers: {} },
  ]
  const r1 = await importMcpToPatch(servers, { profile: 'test' })
  assert.deepEqual(r1.added.sort(), ['tavily', 'web'])
  const doc = parseYaml(readFileSync(r1.target, 'utf8'))
  const rows = doc.flatMap((l) => l.insert ?? [])
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.config.serverName === 'web').config.transport, 'streamable-http')
  // 二次导入同名跳过
  const r2 = await importMcpToPatch(servers, { profile: 'test' })
  assert.equal(r2.added.length, 0)
  assert.equal(r2.skipped.length, 2)
  // dryRun 不写文件
  const before = readFileSync(r1.target, 'utf8')
  await importMcpToPatch([{ name: 'ghost', transport: 'streamable-http', enabled: true, url: 'http://x' }], { profile: 'test', dryRun: true })
  assert.equal(readFileSync(r1.target, 'utf8'), before)
})

test('existingServerNamesInPatch: 损坏 YAML 响亮抛错', () => {
  const dir = join(dshHome, 'profiles', 'broken')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: [unclosed')
  assert.throws(() => existingServerNamesInPatch('broken'), /解析失败/)
})

test('targetOptions: mcp.json 不存在时只有组合层单选项', () => {
  const opts = targetOptions('test')
  assert.equal(opts.length, 1)
  assert.equal(opts[0].id, 'patch')
  assert.ok(opts[0].path.endsWith('cordis.patch.yml'))
})

test('runImport: dryRun 全链路——收集、去重、不落盘', async () => {
  const root = makeClaudeRoot()
  const profile = `dry-${Date.now()}`
  const report = await runImport(
    [{ source: 'claude-code', categories: ['mcp', 'skills'] }],
    { roots: { 'claude-code': root }, ccSwitchDb: join(tmp(), 'nope.db'), profile, target: 'patch', dryRun: true },
  )
  assert.deepEqual(report.mcp.imported.sort(), ['tavily', 'web'])
  assert.equal(report.skills.imported.length, 2)
  assert.equal(report.dryRun, true)
  // dryRun 不落盘：组合层文件不应存在
  assert.equal(existsSync(join(dshHome, 'profiles', profile, 'cordis.patch.yml')), false)
})
