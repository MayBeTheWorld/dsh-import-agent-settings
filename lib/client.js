/**
 * dsh-import-agent-settings — browser half (hand-written lazy-CJS bundle).
 *
 * Registers a row into the General settings page (`settings.general.item`
 * slot). Clicking the row opens a centered backdrop modal listing detected
 * sources; each source card carries a right-side toggle switch (ON = 选中变亮,
 * OFF = 灰度变暗) and expands to category checkboxes. 导入所选 runs the Host
 * /api/dsh-import/run pipeline and shows the result report.
 *
 * Bundle contract: window.__ModuleLoader__.load({ id, factory: (require) => … })
 */
window.__ModuleLoader__.load({
  id: 'dsh-import-agent-settings',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    // 主题适配：颜色一律走 DSH 的 --dsw-alias-* / --dsw-static-* 语义变量（亮/暗自动切换）；
    // var() 第二参 = 官方暗色主题的对应值（抄自 dsh-client-ui-theme/design-platform.css），
    // 仅在脱离主题环境时启用，此时整套装扮退化为一套自洽的暗色 UI。
    var __css =
      '.dsh-import-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.5));backdrop-filter:var(--dsw-mask-blur,blur(2px));z-index:999;display:flex;align-items:center;justify-content:center}' +
      '.dsh-import-card{background:var(--dsw-alias-bg-overlay,rgb(97,102,107));color:inherit;border:1px solid var(--dsw-alias-border-inverted,transparent);border-radius:14px;width:min(640px,92vw);max-height:82vh;display:flex;flex-direction:column;box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 rgba(0,0,0,.2),0 0 4px 0 rgba(0,0,0,.02),0 12px 32px 0 rgba(0,0,0,.08))}' +
      '.dsh-import-head{padding:16px 20px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}' +
      '.dsh-import-title{font-size:15px;font-weight:600;margin:0}' +
      '.dsh-import-sub{font-size:12px;opacity:.65;margin-top:3px}' +
      '.dsh-import-body{flex:1;overflow:auto;padding:10px 20px}' +
      '.dsh-import-src{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:10px;margin:8px 0;overflow:hidden;transition:opacity .18s,border-color .18s}' +
      '.dsh-import-src.on{border-color:var(--dsw-static-neutral-bluish-400,rgb(173,178,184))}' +
      '.dsh-import-src.off{opacity:.45}' +
      '.dsh-import-src-head{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:transparent;border:0;text-align:left;color:inherit;font-size:13.5px}' +
      '.dsh-import-src-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
      '.dsh-import-src-body{padding:2px 14px 12px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.12))}' +
      '.dsh-import-cat{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:7px 0;font-size:13px}' +
      '.dsh-import-cat-note{opacity:.55;font-size:11.5px;flex:1 1 100%;padding-left:24px}' +
      '.dsh-import-cat-off{opacity:.45}' +
      '.dsh-import-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}' +
      '.dsh-import-btn{border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-primary,rgb(249,250,251));padding:7px 16px;font-size:13px;cursor:pointer;transition:background .18s,border-color .18s}' +
      /* 与"外观"方块一致的 hover：中性交互悬浮底色 */
      '.dsh-import-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}' +
      '.dsh-import-btn-primary{background:var(--dsw-alias-button-primary-fill,rgb(249,250,251));border-color:var(--dsw-alias-button-primary-fill,rgb(249,250,251));color:var(--dsw-alias-label-primary-inverted,rgb(53,54,56))}' +
      '.dsh-import-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,rgb(235,238,242));border-color:var(--dsw-alias-button-primary-hover,rgb(235,238,242))}' +
      '.dsh-import-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.dsh-import-report{margin:8px 0;font-size:13px;line-height:1.7}' +
      '.dsh-import-error{color:var(--dsw-alias-state-error-primary,rgb(242,90,90))}' +
      /* 开关 */
      '.dsh-import-switch{position:relative;width:38px;height:21px;flex:none;cursor:pointer;border:0;background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));border-radius:12px;transition:background .18s;padding:0}' +
      '.dsh-import-switch.on{background:var(--dsw-alias-brand-primary,rgb(249,250,251))}' +
      '.dsh-import-switch-knob{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:var(--dsw-alias-label-primary-inverted,rgb(53,54,56));transition:transform .18s}' +
      '.dsh-import-switch.on .dsh-import-switch-knob{transform:translateX(17px)}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-import-agent-settings/style.css"]') === null) {
      var __tag = document.createElement('style')
      __tag.dataset.pluginCss = 'dsh-import-agent-settings/style.css'
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

    /** 右侧滑动开关：开=滑到右侧变亮，关=滑回左侧灰暗。 */
    function ToggleSwitch(props) {
      var on = !!props.on
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        title: on ? '已选中此来源（点击取消）' : '未选中此来源（点击选择）',
        className: 'dsh-import-switch' + (on ? ' on' : ''),
        onClick: function (e) {
          e.stopPropagation()
          e.preventDefault()
          if (props.onToggle) props.onToggle()
        },
      },
        React.createElement('span', { className: 'dsh-import-switch-knob' }),
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

      useEffect(function () {
        var alive = true
        fetch('/api/dsh-import/sources')
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
        fetch('/api/dsh-import/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ selections: selections, target: 'auto', dryRun: previewOnly !== false }),
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
      var closeBtn = React.createElement('button', { className: 'dsh-import-btn', onClick: onClose }, '关闭')

      return React.createElement('div', { className: 'dsh-import-overlay', onClick: function (e) { if (e.target === e.currentTarget) onClose() } },
        React.createElement('div', { className: 'dsh-import-card' },
          React.createElement('div', { className: 'dsh-import-head' },
            React.createElement('p', { className: 'dsh-import-title' }, '从其他智能体导入'),
            React.createElement('p', { className: 'dsh-import-sub' }, '右侧开关选择要导入的来源（开=选中变亮，关=灰暗排除）；点卡片可展开勾选具体类别。'),
          ),
          React.createElement('div', { className: 'dsh-import-body' },
            phase === 'loading' && React.createElement('div', { className: 'dsh-import-report' }, '正在扫描本机智能体来源…'),
            phase === 'error' && React.createElement('div', { className: 'dsh-import-report dsh-import-error' }, '出错：' + error),
            phase === 'ready' && sources.length === 0 && React.createElement('div', { className: 'dsh-import-report' }, '未检测到可导入的来源。'),
            phase === 'ready' && sources.map(function (s) {
              var isOpen = expanded[s.id]
              var isOn = selected[s.id] !== false
              var catKeys = Object.keys(s.categories)
              return React.createElement('div', { key: s.id, className: 'dsh-import-src ' + (isOn ? 'on' : 'off') },
                React.createElement('div', { className: 'dsh-import-src-head' },
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
                isOpen && React.createElement('div', { className: 'dsh-import-src-body' },
                  catKeys.map(function (c) {
                    var info = s.categories[c]
                    var key = s.id + ':' + c
                    var enabled = isOn && info.supported && info.available
                    var label = CATEGORY_LABELS[c] || c
                    var suffix = info.count > 0 ? ' (' + info.count + ')' : ''
                    var note = info.note || (info.supported && info.available ? '' : '暂不支持')
                    return React.createElement('label', {
                      key: c, className: 'dsh-import-cat' + (enabled ? '' : ' dsh-import-cat-off'),
                    },
                      React.createElement('input', {
                        type: 'checkbox', disabled: !enabled,
                        checked: !!checked[key],
                        onChange: enabled ? function () { toggleCat(key) } : undefined,
                      }),
                      React.createElement('span', null, label + suffix),
                      note && React.createElement('span', { className: 'dsh-import-cat-note' }, '· ' + note),
                    )
                  }),
                ),
              )
            }),
            phase === 'running' && React.createElement('div', { className: 'dsh-import-report' }, '导入中…'),
            phase === 'done' && report && React.createElement('div', { className: 'dsh-import-report' },
              React.createElement('strong', null, '导入完成'),
              React.createElement('div', null, 'MCP 已导入：' + (report.mcp.imported.length ? report.mcp.imported.join('、') : '无')),
              report.mcp.skipped.length > 0 && React.createElement('div', null, 'MCP 跳过：' + report.mcp.skipped.join('；')),
              React.createElement('div', null, 'Skills 已导入：' + (report.skills.imported.length ? report.skills.imported.join('、') : '无')),
              report.skills.skipped.length > 0 && React.createElement('div', null, 'Skills 跳过：' + report.skills.skipped.join('；')),
              report.notes.length > 0 && React.createElement('div', null,
                React.createElement('span', { className: 'dsh-import-cat-note' }, '说明：'),
                report.notes.map(function (n, i) { return React.createElement('div', { key: i, className: 'dsh-import-cat-note' }, '· ' + n) })),
              report.dryRun && React.createElement('div', null, '（dry-run，未实际写入）'),
            ),
          ),
          React.createElement('div', { className: 'dsh-import-foot' },
            React.createElement('button', { className: 'dsh-import-btn', onClick: onClose }, '取消'),
            phase === 'ready' && React.createElement('button', {
              className: 'dsh-import-btn dsh-import-btn-primary',
              disabled: selectedCount === 0,
              onClick: function () { run(true) },
            }, '导入所选（预演）' + (selectedCount ? '（' + selectedCount + ' 个来源）' : '')),
            phase === 'preview' && React.createElement('button', {
              className: 'dsh-import-btn dsh-import-btn-primary',
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
        React.createElement('button', { className: 'dsh-import-btn', onClick: function () { setOpen(true) } }, '导入'),
        open && React.createElement(ImportModal, { onClose: function () { setOpen(false) } }),
      )
    }

    function apply(ctx) {
      try {
        ctx.slots.inject('settings.general.item', function () {
          return ctx.slots.register({
            name: 'settings.general.item',
            id: 'import-agent-settings',
            order: -10,
          }, ImportRow)
        })
      } catch (e) {
        console.error('[dsh-import-agent-settings] slot registration failed', e)
      }
    }

    module.exports = {
      name: 'import-agent-settings-client',
      inject: ['slots'],
      apply: apply,
    }
    return module.exports
  },
})
