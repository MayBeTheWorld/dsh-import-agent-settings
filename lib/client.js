/**
 * dsh-inherit — browser half (hand-written lazy-CJS bundle).
 *
 * Registers a row into the General settings page (`settings.general.item`
 * slot). Clicking the row opens a centered backdrop modal listing detected
 * sources; each source card carries a right-side toggle switch (ON = 选中变亮,
 * OFF = 灰度变暗) and expands to category checkboxes. 导入所选 runs the Host
 * /api/dsh-inherit/run pipeline and shows the result report.
 *
 * Bundle contract: window.__ModuleLoader__.load({ id, factory: (require) => … })
 */
window.__ModuleLoader__.load({
  id: 'dsh-inherit',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    // 主题适配：颜色一律走 DSH 的 --dsw-alias-* / --dsw-static-* 语义变量（亮/暗自动切换）；
    // var() 第二参 = 官方暗色主题的对应值（抄自 dsh-client-ui-theme/design-platform.css），
    // 仅在脱离主题环境时启用，此时整套装扮退化为一套自洽的暗色 UI。
    var __css =
      '.dsh-inherit-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.5));backdrop-filter:var(--dsw-mask-blur,blur(2px));z-index:999;display:flex;align-items:center;justify-content:center}' +
      /* 弹窗卡片用 bg-layer-2 而非 bg-overlay：官方设置弹窗同款（亮=白、暗=bluish-850，
         亮色主题靠 shadow-lv3 表达层级）；bg-overlay 亮暗两主题方向相反（亮主题反比页面暗），不适合卡片 */
      '.dsh-inherit-card{background:var(--dsw-alias-bg-layer-2,rgb(44,44,46));color:inherit;border:1px solid var(--dsw-alias-border-inverted,transparent);border-radius:14px;width:min(640px,92vw);max-height:82vh;display:flex;flex-direction:column;box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 rgba(0,0,0,.2),0 0 4px 0 rgba(0,0,0,.02),0 12px 32px 0 rgba(0,0,0,.08))}' +
      '.dsh-inherit-head{padding:16px 20px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}' +
      '.dsh-inherit-title{font-size:15px;font-weight:600;margin:0}' +
      '.dsh-inherit-sub{font-size:12px;opacity:.65;margin-top:3px}' +
      '.dsh-inherit-body{flex:1;overflow:auto;padding:10px 20px}' +
      '.dsh-inherit-src{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:10px;margin:8px 0;overflow:hidden;transition:opacity .18s,border-color .18s}' +
      '.dsh-inherit-src.on{border-color:var(--dsw-static-neutral-bluish-400,rgb(173,178,184))}' +
      '.dsh-inherit-src.off{opacity:.45}' +
      '.dsh-inherit-src-head{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:transparent;border:0;text-align:left;color:inherit;font-size:13.5px}' +
      '.dsh-inherit-src-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
      '.dsh-inherit-src-body{padding:2px 14px 12px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.12))}' +
      '.dsh-inherit-cat{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:7px 0;font-size:13px}' +
      '.dsh-inherit-cat-note{opacity:.55;font-size:11.5px;flex:1 1 100%;padding-left:24px}' +
      '.dsh-inherit-cat-off{opacity:.45}' +
      '.dsh-inherit-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}' +
      '.dsh-inherit-btn{border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-primary,rgb(249,250,251));padding:7px 16px;font-size:13px;cursor:pointer;transition:background .18s,border-color .18s}' +
      /* 与"外观"方块一致的 hover：中性交互悬浮底色 */
      '.dsh-inherit-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
      '.dsh-inherit-btn-primary{background:var(--dsw-alias-button-primary-fill,rgb(249,250,251));border-color:var(--dsw-alias-button-primary-fill,rgb(249,250,251));color:var(--dsw-alias-label-primary-inverted,rgb(53,54,56))}' +
      '.dsh-inherit-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,rgb(235,238,242));border-color:var(--dsw-alias-button-primary-hover,rgb(235,238,242))}' +
      '.dsh-inherit-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.dsh-inherit-report{margin:8px 0;font-size:13px;line-height:1.7}' +
      /* 报告：统计条 + 芯片 + 跳过分组折叠（替代整墙文字） */
      '.dsh-inherit-stats{display:flex;gap:8px;margin:10px 0 2px}' +
      '.dsh-inherit-stat{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:10px;padding:9px 12px}' +
      '.dsh-inherit-stat-num{font-size:20px;font-weight:600;line-height:1.25}' +
      '.dsh-inherit-stat-num.ok{color:var(--dsw-alias-state-success-primary,rgb(34,197,94))}' +
      '.dsh-inherit-stat-num.zero{opacity:.35}' +
      '.dsh-inherit-stat-label{font-size:11.5px;opacity:.6;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.dsh-inherit-sec{margin-top:14px}' +
      '.dsh-inherit-sec-title{font-size:12.5px;font-weight:600;opacity:.8;margin:0 0 8px}' +
      '.dsh-inherit-chips{display:flex;flex-wrap:wrap;gap:6px}' +
      '.dsh-inherit-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:6px;padding:2px 8px;font-size:12px;line-height:20px;max-width:100%}' +
      '.dsh-inherit-chip-check{color:var(--dsw-alias-state-success-primary,rgb(34,197,94));font-weight:600}' +
      '.dsh-inherit-chip-skip{opacity:.55;font-size:11.5px}' +
      '.dsh-inherit-skip{border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;margin:6px 0;overflow:hidden}' +
      '.dsh-inherit-skip-head{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;background:transparent;border:0;color:inherit;font-size:12px;cursor:pointer;text-align:left}' +
      '.dsh-inherit-skip-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
      '.dsh-inherit-skip-count{margin-left:auto;opacity:.55;flex:none}' +
      '.dsh-inherit-skip-body{padding:2px 10px 9px;display:flex;flex-wrap:wrap;gap:6px}' +
      '.dsh-inherit-notes{margin-top:14px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.12))}' +
      /* 工具调用结果（能力委派） */
      '.dsh-inherit-tool{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 0}' +
      '.dsh-inherit-tool-out{white-space:pre-wrap;word-break:break-all;font-size:11.5px;opacity:.75;margin:2px 0 8px;padding:8px 10px;border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;max-height:160px;overflow:auto}' +
      /* 写入位置选择器 */
      '.dsh-inherit-target-row{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.12));font-size:12.5px}' +
      '.dsh-inherit-target-label{opacity:.65;flex:none}' +
      '.dsh-inherit-target-select{flex:1;min-width:0;background:var(--dsw-alias-bg-overlay,rgb(97,102,107));color:var(--dsw-alias-label-primary,rgb(249,250,251));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:6px 8px;font-size:12.5px;cursor:pointer}' +
      '.dsh-inherit-error{color:var(--dsw-alias-state-error-primary,rgb(242,90,90))}' +
      /* 开关 */
      '.dsh-inherit-switch{position:relative;width:38px;height:21px;flex:none;cursor:pointer;border:0;background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));border-radius:12px;transition:background .18s;padding:0}' +
      '.dsh-inherit-switch.on{background:var(--dsw-alias-brand-primary,rgb(249,250,251))}' +
      '.dsh-inherit-switch-knob{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:var(--dsw-alias-label-primary-inverted,rgb(53,54,56));transition:transform .18s}' +
      '.dsh-inherit-switch.on .dsh-inherit-switch-knob{transform:translateX(17px)}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-inherit/style.css"]') === null) {
      var __tag = document.createElement('style')
      __tag.dataset.pluginCss = 'dsh-inherit/style.css'
      __tag.textContent = __css
      document.head.appendChild(__tag)
    }

    var React = require('react')
    var useState = React.useState
    var useEffect = React.useEffect

    var CATEGORY_LABELS = {
      mcp: 'MCP 服务器', skills: 'Skills', instructions: '指令文件',
      providers: '模型供应商', prompts: '提示词', memory: '记忆', sessions: '会话记录',
    }

    /** 跳过项分组（按原因折叠）：头部显示原因与数量，展开后是灰暗芯片列表。 */
    function SkipGroup(props) {
      var [open, setOpen] = useState(false)
      return React.createElement('div', { className: 'dsh-inherit-skip' },
        React.createElement('button', {
          type: 'button', className: 'dsh-inherit-skip-head',
          onClick: function () { setOpen(!open) },
        },
          React.createElement('span', null, open ? '▾' : '▸'),
          React.createElement('span', null, props.reason),
          React.createElement('span', { className: 'dsh-inherit-skip-count' }, props.names.length + ' 项'),
        ),
        open && React.createElement('div', { className: 'dsh-inherit-skip-body' },
          props.names.map(function (n, i) {
            return React.createElement('span', { key: i, className: 'dsh-inherit-chip dsh-inherit-chip-skip' }, n)
          }),
        ),
      )
    }

    /** 把 "name（reason）" 形式的跳过项按原因分组，保持出现顺序；不合形归入原样条目。 */
    function groupSkipped(list) {
      var groups = []
      var byReason = {}
      list.forEach(function (entry) {
        var m = /^(.*?)（(.+)）$/.exec(entry)
        var name = m ? m[1] : entry
        var reason = m ? m[2] : '其他'
        if (!byReason[reason]) { byReason[reason] = []; groups.push([reason, byReason[reason]]) }
        byReason[reason].push(name)
      })
      return groups
    }
    /** 右侧滑动开关：开=滑到右侧变亮，关=滑回左侧灰暗。 */
    function ToggleSwitch(props) {
      var on = !!props.on
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        title: on ? '已选中此来源（点击取消）' : '未选中此来源（点击选择）',
        className: 'dsh-inherit-switch' + (on ? ' on' : ''),
        onClick: function (e) {
          e.stopPropagation()
          e.preventDefault()
          if (props.onToggle) props.onToggle()
        },
      },
        React.createElement('span', { className: 'dsh-inherit-switch-knob' }),
      )
    }

    function ImportModal(props) {
      var onClose = props.onClose
      var [phase, setPhase] = useState('loading')
      var [sources, setSources] = useState([])
      var [expanded, setExpanded] = useState({})
      var [selected, setSelected] = useState({})
      var [checked, setChecked] = useState({})
      var [report, setReport] = useState(null)
      var [error, setError] = useState(null)
      var [targets, setTargets] = useState([])
      var [target, setTarget] = useState('auto')

      useEffect(function () {
        var alive = true
        fetch('/api/dsh-inherit/sources')
          .then(function (r) { return r.json() })
          .then(function (json) {
            if (!alive) return
            if (!json.ok) { setError(json.error); setPhase('error'); return }
            var list = json.sources.filter(function (s) { return s.found })
            setSources(list)
            var initChecked = {}
            var initExpanded = {}
            var initSelected = {}
            list.forEach(function (s) {
              initExpanded[s.id] = false
              initSelected[s.id] = true // 默认全部选中 = 一键全导
              Object.keys(s.categories).forEach(function (c) {
                var info = s.categories[c]
                if (info && info.supported && info.available) initChecked[s.id + ':' + c] = true
              })
            })
            setChecked(initChecked)
            setExpanded(initExpanded)
            setSelected(initSelected)
            setTargets(Array.isArray(json.targets) ? json.targets : [])
            if (json.defaultTarget) setTarget(json.defaultTarget)
            setPhase('ready')
          })
          .catch(function (e) { if (alive) { setError(String(e)); setPhase('error') } })
        return function () { alive = false }
      }, [])

      useEffect(function () {
        function onKey(e) { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [onClose])

      function toggleSelected(id) {
        setSelected(function (prev) {
          var next = Object.assign({}, prev)
          next[id] = !prev[id]
          return next
        })
      }

      function toggleCat(key) {
        setChecked(function (prev) {
          var next = Object.assign({}, prev)
          if (next[key]) delete next[key]
          else next[key] = true
          return next
        })
      }

      function run(previewOnly) {
        var selections = []
        sources.forEach(function (s) {
          if (!selected[s.id]) return
          var cats = Object.keys(s.categories).filter(function (c) { return checked[s.id + ':' + c] })
          if (cats.length) selections.push({ source: s.id, categories: cats })
        })
        if (!selections.length) return
        setPhase('running')
        fetch('/api/dsh-inherit/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ selections: selections, target: target, dryRun: previewOnly !== false }),
        })
          .then(function (r) { return r.json() })
          .then(function (json) {
            if (!json.ok) { setError(json.error); setPhase('error'); return }
            setReport(json.report)
            setPhase(previewOnly !== false ? 'preview' : 'done')
          })
          .catch(function (e) { setError(String(e)); setPhase('error') })
      }

      var selectedCount = sources.filter(function (s) { return selected[s.id] }).length
      var closeBtn = React.createElement('button', { className: 'dsh-inherit-btn', onClick: onClose }, '关闭')
      /** 返回勾选页（保留已选状态，仅切回 ready 阶段）。 */
      var backBtn = React.createElement('button', { className: 'dsh-inherit-btn', onClick: function () { setPhase('ready') } }, '返回')

      /** 渲染导入报告；isPreview=true 时是 dry-run 预演结果，标题与措辞区分。 */
      function renderReport(isPreview) {
        var verb = isPreview ? '将导入' : '已导入'
        return React.createElement('div', { className: 'dsh-inherit-report' },
          React.createElement('strong', null, isPreview ? '预演结果（未实际写入）' : '导入完成'),
          React.createElement('div', { className: 'dsh-inherit-stats' },
            statCard(report.mcp.imported.length, 'MCP ' + verb, report.mcp.imported.length > 0),
            statCard(report.mcp.skipped.length, 'MCP 跳过', false),
            statCard(report.skills.imported.length, 'Skills ' + verb, report.skills.imported.length > 0),
            statCard(report.skills.skipped.length, 'Skills 跳过', false),
          ),
          reportSection('MCP 服务器', report.mcp.imported, report.mcp.skipped),
          reportSection('Skills', report.skills.imported, report.skills.skipped),
          report.delegated && report.delegated.length > 0 && React.createElement('div', { className: 'dsh-inherit-sec' },
            React.createElement('p', { className: 'dsh-inherit-sec-title' }, isPreview ? '工具调用（预演）' : '工具调用'),
            report.delegated.map(function (d, i) {
              return React.createElement('div', { key: i },
                React.createElement('div', { className: 'dsh-inherit-tool' },
                  React.createElement('span', {
                    className: 'dsh-inherit-chip-check',
                    style: d.ok ? undefined : { color: 'var(--dsw-alias-state-error-primary, rgb(242,90,90))' },
                  }, d.ok ? '✓' : '✗'),
                  React.createElement('span', null, d.tool),
                ),
                d.output && React.createElement('div', { className: 'dsh-inherit-tool-out' }, d.output),
              )
            }),
          ),
          report.notes.length > 0 && React.createElement('div', { className: 'dsh-inherit-notes' },
            React.createElement('span', { className: 'dsh-inherit-cat-note' }, '说明：'),
            report.notes.map(function (n, i) { return React.createElement('div', { key: i, className: 'dsh-inherit-cat-note' }, '· ' + n) })),
        )
      }

      /** 统计条里的一格：数字 + 标签；ok=绿色强调，0 值压暗。 */
      function statCard(num, label, ok) {
        return React.createElement('div', { className: 'dsh-inherit-stat' },
          React.createElement('div', { className: 'dsh-inherit-stat-num' + (ok ? ' ok' : num === 0 ? ' zero' : '') }, String(num)),
          React.createElement('div', { className: 'dsh-inherit-stat-label' }, label),
        )
      }

      /** 一类别的结果分区：导入项亮芯片（✓ 前缀），跳过项按原因折叠分组。 */
      function reportSection(title, imported, skipped) {
        if (!imported.length && !skipped.length) return null
        return React.createElement('div', { className: 'dsh-inherit-sec' },
          React.createElement('p', { className: 'dsh-inherit-sec-title' }, title),
          imported.length > 0 && React.createElement('div', { className: 'dsh-inherit-chips' },
            imported.map(function (n, i) {
              return React.createElement('span', { key: i, className: 'dsh-inherit-chip' },
                React.createElement('span', { className: 'dsh-inherit-chip-check' }, '✓'), n)
            }),
          ),
          groupSkipped(skipped).map(function (g, i) {
            return React.createElement(SkipGroup, { key: i, reason: g[0], names: g[1] })
          }),
        )
      }

      /** 各阶段副标题提示；无提示的阶段（loading/running/error）不渲染副标题。 */
      var PHASE_HINTS = {
        ready: '右侧开关选择要导入的来源（开=选中变亮，关=灰暗排除）；点卡片可展开勾选具体类别。',
        preview: '预演结果，尚未写入；确认写入后生效。',
        done: '导入完成，以下为写入结果。',
      }

      return React.createElement('div', { className: 'dsh-inherit-overlay', onClick: function (e) { if (e.target === e.currentTarget) onClose() } },
        React.createElement('div', { className: 'dsh-inherit-card' },
          React.createElement('div', { className: 'dsh-inherit-head' },
            React.createElement('p', { className: 'dsh-inherit-title' }, '从其他智能体导入'),
            PHASE_HINTS[phase] && React.createElement('p', { className: 'dsh-inherit-sub' }, PHASE_HINTS[phase]),
          ),
          React.createElement('div', { className: 'dsh-inherit-body' },
            phase === 'loading' && React.createElement('div', { className: 'dsh-inherit-report' }, '正在扫描本机智能体来源…'),
            phase === 'error' && React.createElement('div', { className: 'dsh-inherit-report dsh-inherit-error' }, '出错：' + error),
            phase === 'ready' && sources.length === 0 && React.createElement('div', { className: 'dsh-inherit-report' }, '未检测到可导入的来源。'),
            phase === 'ready' && sources.map(function (s) {
              var isOpen = expanded[s.id]
              var isOn = selected[s.id] !== false
              var catKeys = Object.keys(s.categories)
              return React.createElement('div', { key: s.id, className: 'dsh-inherit-src ' + (isOn ? 'on' : 'off') },
                React.createElement('div', { className: 'dsh-inherit-src-head' },
                  React.createElement('button', {
                    type: 'button',
                    style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0, fontSize: 13.5 },
                    onClick: function () { setExpanded(function (p) { var n = Object.assign({}, p); n[s.id] = !p[s.id]; return n }) },
                  },
                    React.createElement('span', null, isOpen ? '▾' : '▸'),
                    React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.name),
                  ),
                  React.createElement(ToggleSwitch, { on: isOn, onToggle: function () { toggleSelected(s.id) } }),
                ),
                isOpen && React.createElement('div', { className: 'dsh-inherit-src-body' },
                  catKeys.map(function (c) {
                    var info = s.categories[c]
                    var key = s.id + ':' + c
                    var enabled = isOn && (info.supported ? info.available : !!info.delegate)
                    var label = CATEGORY_LABELS[c] || c
                    var suffix = info.count > 0 ? ' (' + info.count + ')' : ''
                    var note = info.note || (info.supported ? (info.available ? '' : '未检测到内容') : '暂不支持')
                    return React.createElement('label', {
                      key: c, className: 'dsh-inherit-cat' + (enabled ? '' : ' dsh-inherit-cat-off'),
                    },
                      React.createElement('input', {
                        type: 'checkbox', disabled: !enabled,
                        checked: !!checked[key],
                        onChange: enabled ? function () { toggleCat(key) } : undefined,
                      }),
                      React.createElement('span', null, label + suffix),
                      note && React.createElement('span', { className: 'dsh-inherit-cat-note' }, '· ' + note),
                    )
                  }),
                ),
              )
            }),
            phase === 'ready' && targets.length > 1 && React.createElement('div', { className: 'dsh-inherit-target-row' },
              React.createElement('span', { className: 'dsh-inherit-target-label' }, 'MCP 写入位置'),
              React.createElement('select', {
                className: 'dsh-inherit-target-select',
                value: target,
                onChange: function (e) { setTarget(e.target.value) },
              },
                targets.map(function (t) {
                  return React.createElement('option', { key: t.id, value: t.id, title: t.path || t.label },
                    t.label + (t.path ? ' — ' + t.path : ''))
                }),
              ),
            ),
            phase === 'running' && React.createElement('div', { className: 'dsh-inherit-report' }, '导入中…'),
            phase === 'preview' && report && renderReport(true),
            phase === 'done' && report && renderReport(false),
          ),
          React.createElement('div', { className: 'dsh-inherit-foot' },
            phase === 'ready' && React.createElement('button', { className: 'dsh-inherit-btn', onClick: onClose }, '取消'),
            phase === 'preview' && backBtn,
            phase === 'ready' && React.createElement('button', {
              className: 'dsh-inherit-btn dsh-inherit-btn-primary',
              disabled: selectedCount === 0,
              onClick: function () { run(true) },
            }, '导入所选（预演）' + (selectedCount ? '（' + selectedCount + ' 个来源）' : '')),
            phase === 'preview' && React.createElement('button', {
              className: 'dsh-inherit-btn dsh-inherit-btn-primary',
              onClick: function () { run(false) },
            }, '确认写入'),
            phase === 'done' && closeBtn,
          ),
        ),
      )
    }

    /** 通用设置页里的一行：点击弹出导入弹窗。 */
    function ImportRow() {
      var [open, setOpen] = useState(false)
      return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))' } },
        React.createElement('div', { style: { flex: 1, minWidth: 0, paddingRight: 48, display: 'flex', flexDirection: 'column', gap: 4 } },
          React.createElement('div', { style: { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary, rgb(249,250,251))' } }, '导入智能体设置'),
          React.createElement('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, rgb(173,178,184))' } }, '从本机其他智能体工具导入 MCP、Skills 等设置'),
        ),
        React.createElement('button', { className: 'dsh-inherit-btn', onClick: function () { setOpen(true) } }, '导入'),
        open && React.createElement(ImportModal, { onClose: function () { setOpen(false) } }),
      )
    }

    function apply(ctx) {
      try {
        ctx.slots.inject('settings.general.item', function () {
          return ctx.slots.register({
            name: 'settings.general.item',
            id: 'inherit',
            order: -10,
          }, ImportRow)
        })
      } catch (e) {
        console.error('[dsh-inherit] slot registration failed', e)
      }
    }

    module.exports = {
      name: 'inherit-client',
      inject: ['slots'],
      apply: apply,
    }
    return module.exports
  },
})
