/* global window, fetch, AbortController */
// DeepJIT browser half: a read-only status panel on the plugin detail page.
// Hand-written lazy-CJS factory (dsh third-party client-plugin format); React
// comes from the browser module table, so there is no bundler or build step.
// Data arrives via a document-relative fetch to the Host's exact Connection
// Fetch route (api/deepjit/status) — no leading slash, no hardcoded origin.
window.__ModuleLoader__.load({
  id: '@fly3366/deepjit',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    const PACKAGE = '@fly3366/deepjit'
    const STATUS_ROUTE = 'api/deepjit/status'

    const en = {
      title: 'JIT status',
      refresh: 'Refresh',
      loading: 'Loading…',
      inactive: 'DeepJIT is not active.',
      error: 'Failed to load status.',
      empty: 'No compiled artifacts yet.',
      statArtifacts: 'Artifacts',
      statPatterns: 'Patterns',
      statSessions: 'Sessions',
      statTraces: 'Traces',
      colStatus: 'Status',
      colType: 'Type',
      colName: 'Name',
      colDescription: 'Description',
      colQuality: 'Quality',
      colUses: 'Uses',
      active: 'active',
      disabled: 'disabled',
      missingFile: 'missing file',
    }
    const zh = {
      title: 'JIT 状态',
      refresh: '刷新',
      loading: '加载中…',
      inactive: 'DeepJIT 未启用。',
      error: '状态加载失败。',
      empty: '暂无编译产物。',
      statArtifacts: '产物',
      statPatterns: '模式',
      statSessions: '会话',
      statTraces: '轨迹',
      colStatus: '状态',
      colType: '类型',
      colName: '名称',
      colDescription: '描述',
      colQuality: '质量',
      colUses: '使用',
      active: '启用',
      disabled: '停用',
      missingFile: '文件缺失',
    }

    // Theme tokens only (--dsw-alias-*); no literal colors. Row/list spacing
    // mirrors the Plugin Manager management list.
    const css = [
      '.deepjit-panel{display:flex;flex-direction:column;gap:12px;padding:16px 0;color:var(--dsw-alias-label-primary);font-size:13px}',
      '.deepjit-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.deepjit-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.deepjit-stats{display:flex;flex-wrap:wrap;gap:12px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.deepjit-stat b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.deepjit-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.deepjit-table th{text-align:left;padding:6px 8px;color:var(--dsw-alias-label-tertiary);font-weight:500;border-bottom:1px solid var(--dsw-alias-border-l3)}',
      '.deepjit-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);vertical-align:top}',
      '.deepjit-name{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.deepjit-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px}',
      '.deepjit-active{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}',
      '.deepjit-disabled{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.deepjit-btn{padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}',
      '.deepjit-btn:hover{background:var(--dsw-alias-interactive-bg-active)}',
      '.deepjit-btn:disabled{opacity:.5;cursor:default}',
      '.deepjit-empty{color:var(--dsw-alias-label-tertiary);padding:12px 0}',
      '.deepjit-muted{color:var(--dsw-alias-label-tertiary)}',
      '.deepjit-error{color:var(--dsw-alias-state-error-primary)}',
    ].join('\n')

    function stat(label, value) {
      return h('span', { className: 'deepjit-stat' }, label + ': ', h('b', null, String(value)))
    }

    function StatusPanel(props) {
      const subject = props.subject
      const t = typeof props.t === 'function' ? props.t : (k) => en[k] || k
      const isDeepjit = !!subject && subject.kind === 'bundle' && !!subject.pkg && subject.pkg.name === PACKAGE
      // Hooks run unconditionally (consistent order); the null render is below.
      const [state, setState] = useState({ phase: 'loading' })
      const [reloadKey, setReloadKey] = useState(0)

      useEffect(() => {
        if (!isDeepjit) return undefined
        const ac = new AbortController()
        let alive = true
        setState({ phase: 'loading' })
        fetch(STATUS_ROUTE, { signal: ac.signal })
          .then((res) => {
            if (res.status === 404) {
              if (alive) setState({ phase: 'inactive' })
              return null
            }
            if (!res.ok) throw new Error('http-' + res.status)
            return res.json()
          })
          .then((data) => {
            if (alive && data) setState({ phase: 'ready', data: data })
          })
          .catch((err) => {
            if (alive && err && err.name !== 'AbortError') setState({ phase: 'error' })
          })
        return () => {
          alive = false
          ac.abort()
        }
      }, [isDeepjit, reloadKey])

      if (!isDeepjit) return null

      const refresh = () => setReloadKey((k) => k + 1)
      const out = []
      out.push(h('style', { key: 'css' }, css))
      out.push(h('div', { className: 'deepjit-head', key: 'head' },
        h('span', { className: 'deepjit-title' }, t('title')),
        h('button', { className: 'deepjit-btn', type: 'button', onClick: refresh, disabled: state.phase === 'loading' }, t('refresh')),
      ))

      if (state.phase === 'loading') {
        out.push(h('div', { className: 'deepjit-muted', key: 'msg' }, t('loading')))
      } else if (state.phase === 'inactive') {
        out.push(h('div', { className: 'deepjit-empty', key: 'msg' }, t('inactive')))
      } else if (state.phase === 'error') {
        out.push(h('div', { className: 'deepjit-error', key: 'msg' }, t('error')))
      } else {
        const data = state.data
        const s = data.stats || {}
        out.push(h('div', { className: 'deepjit-stats', key: 'stats' },
          stat(t('statArtifacts'), s.artifacts || 0),
          stat(t('statPatterns'), s.patterns || 0),
          stat(t('statSessions'), s.sessions || 0),
          stat(t('statTraces'), s.traces || 0),
        ))
        const rows = data.artifacts || []
        if (rows.length === 0) {
          out.push(h('div', { className: 'deepjit-empty', key: 'empty' }, t('empty')))
        } else {
          out.push(h('table', { className: 'deepjit-table', key: 'table' },
            h('thead', null, h('tr', null,
              h('th', null, t('colStatus')),
              h('th', null, t('colType')),
              h('th', null, t('colName')),
              h('th', null, t('colDescription')),
              h('th', null, t('colQuality')),
              h('th', null, t('colUses')),
            )),
            h('tbody', null, rows.map((a) => h('tr', { key: a.name },
              h('td', null, h('span', { className: 'deepjit-badge ' + (a.status === 'active' ? 'deepjit-active' : 'deepjit-disabled') }, a.status === 'active' ? t('active') : t('disabled'))),
              h('td', null, a.type),
              h('td', { className: 'deepjit-name' }, a.name + (a.fileOk ? '' : ' (' + t('missingFile') + ')')),
              h('td', null, a.description || ''),
              h('td', null, String(a.quality)),
              h('td', null, String(a.use_count)),
            ))),
          ))
        }
      }
      return h('div', { className: 'deepjit-panel' }, out)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('deepjit', { en: en, zh: zh }), 'deepjit: dictionaries')
        ctx.effect(() => ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          name: 'plugins.detail.section', id: 'deepjit-status', order: 10, locale: 'deepjit',
        }, StatusPanel)), 'deepjit: status panel')
      },
    }
  },
})