/**
 * dsh-model-label — browser half.
 *
 * The stock composer model seat (`conversation.input.model`) renders only the
 * model's catalog display name plus the reasoning-effort name, e.g.
 * `DeepSeek V4.1 Flash · Max`. This plugin shadows that one seat (a `single`
 * Slot: the lowest-`priority` registration wins the cell) with a seat that
 * prefixes the provider's display name, so the same selection reads
 * `火山方舟/DeepSeek V4.1 Flash · Max`.
 *
 * Both halves of the label are DISPLAY NAMES from the catalog, never ids. The
 * raw `provider/model` ids appear only as a fallback when the saved selection
 * has no catalog entry left (provider removed, model retired, account signed
 * out) — the user still needs to see what is saved, and the id is then the only
 * name that exists.
 *
 * Every model NAME is additionally routed through the official
 * `conversation.input.model.label` child slot (declared on our registration
 * exactly as the shipped seat declares it). That slot is the harness's
 * sanctioned extension point for non-interactive label decoration, so official
 * label decorations — the temporary 1017 release badge today, whatever ships
 * there tomorrow — keep working inside this shadowing seat. With no occupant
 * the slot renders our fallback (the plain catalog name), which reads
 * identically to the old self-rendered label.
 *
 * The model pane is a COLLAPSIBLE TREE folded by provider: one toggle row per
 * provider, its models nested underneath, and only the provider that owns the
 * current selection open by default. A provider the user opens or closes keeps
 * that choice; everything else follows the selection. Typing in the search box
 * unfolds every provider that still has a match, because a folded hit would
 * otherwise be invisible.
 *
 * Everything else about the seat is preserved: the two-level Model/Effort menu,
 * fuzzy search, keyboard handling, pending spinners, failure toasts, and the
 * shared per-session ModelDirectory both the seat and `/model` write through.
 *
 * Hand-written ModuleLoader bundle: no build step, and no dependency beyond the
 * `react`/`react-dom` modules the shell already provides. Per the harness
 * plugin practices, NO Harness Client package (primitives included) is loaded
 * as a module: the few controls the stock seat borrows from
 * `@deepseek-ai/dsh-client-ui-primitives` are self-hosted below with the same
 * markup shape, theme tokens only, and classes renamed under this plugin's
 * prefix — icons, the busy dot, the menu surface, the search input, the
 * anchored toast, and the fuzzy `rankByName`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-label',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const { useState, useEffect, useMemo, useRef, useCallback } = React
    const { createElement: h, Fragment } = React
    const { createPortal } = require('react-dom')

    const clsx = (...parts) => parts.filter(Boolean).join(' ')

    const NS = 'dsh-model-label'

    const DICT = {
      zh: {
        'menu.aria': '模型与推理等级',
        'menu.model': '模型',
        'menu.effort': '推理等级',
        'effort.providerDefault': '默认',
        'trigger.fallback': '请选择模型',
        'trigger.loading': '正在加载模型…',
        'trigger.selectAria': '请选择模型',
        'trigger.aria': '选择模型，当前 {model}',
        'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
        'provider.account': 'DeepSeek 账号',
        'provider.expand': '展开 {name}',
        'provider.collapse': '折叠 {name}',
        'provider.count': '{count} 个模型',
        'status.loading': '正在刷新模型列表…',
        'error.action': '模型操作失败：{message}',
        'error.sessionInUse':
          '当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。',
        'action.reload': '重新加载',
        'warning.groupLoad': '{name} 加载失败：{message}',
        'search.placeholder': '搜索模型…',
        'search.clear': '清除搜索',
        'search.empty': '没有匹配的模型。',
        'empty.models': '没有可用的模型。',
        'empty.efforts': '当前模型未提供推理等级。',
      },
      en: {
        'menu.aria': 'Model and reasoning effort',
        'menu.model': 'Model',
        'menu.effort': 'Effort',
        'effort.providerDefault': 'Default',
        'trigger.fallback': 'Select model',
        'trigger.loading': 'Loading models…',
        'trigger.selectAria': 'Select model',
        'trigger.aria': 'Select model, current {model}',
        'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
        'provider.account': 'DeepSeek Account',
        'provider.expand': 'Expand {name}',
        'provider.collapse': 'Collapse {name}',
        'provider.count': '{count} models',
        'status.loading': 'Refreshing model list…',
        'error.action': 'Model operation failed: {message}',
        'error.sessionInUse':
          'This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.',
        'action.reload': 'Reload',
        'warning.groupLoad': '{name} failed to load: {message}',
        'search.placeholder': 'Search models…',
        'search.clear': 'Clear search',
        'search.empty': 'No matching models.',
        'empty.models': 'No models available.',
        'empty.efforts': 'This model provides no reasoning effort levels.',
      },
    }

    // ── self-hosted controls (no Harness Client package is loaded as a module) ─
    //
    // The stock seat borrows these from `dsh-client-ui-primitives`. Per the
    // harness plugin practices they are reimplemented here: markup and behavior
    // copied from the host controls, classes renamed under the `dml_` prefix,
    // and only `--dsw-*` theme tokens shared — a renamed or reworked primitive
    // can then never break this seat, and a theme switch still follows.

    // Styles reuse the stock seat's own class names where they are global, and
    // otherwise carry our own scoped prefix. Colour comes from theme variables so
    // the seat follows a scheme switch.
    //
    // The tree rows deliberately do NOT reuse the primitives' `MenuGroup`: its
    // heading is a plain `div` with `position:sticky`, so it cannot be a toggle,
    // and its sticky pass (`observeStickyMenuGroups`) expects every direct child
    // of the viewport to be one of those groups — which a folded tree breaks.
    // The provider toggle borrows the group heading's own type scale instead.
    const CSS = `
.dml_root{min-width:0;position:relative}
.dml_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(520px,60cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}
.dml_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dml_trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dml_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dml_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dml_triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden}
.dml_triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}
.dml_triggerLabel,.dml_triggerEffort{display:var(--dsh-composer-model-text-display,block)}
.dml_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}
.dml_chevronOpen{transform:rotate(180deg)}
.dml_menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-radius:var(--dsw-radius-md);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}
.dml_status,.dml_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}
.dml_error,.dml_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;font-size:12px;line-height:18px;display:flex}
.dml_warning{background:var(--dsw-alias-interactive-bg-hover-warning,#3a3320);color:var(--dsw-alias-state-warning-primary,#f0a441)}
.dml_retry{color:inherit;cursor:pointer;background:0 0;border:0;font:inherit;text-decoration:underline;padding:0}
.dml_groups{flex-direction:column;display:flex;padding:2px;overflow-y:auto}
.dml_searchRow{padding:4px 4px 6px;display:flex;position:relative;align-items:center}
.dml_search{flex:1;min-width:0;height:26px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:0 26px 0 8px;font:inherit;font-size:13px;line-height:20px;outline:none}
.dml_search::placeholder{color:var(--dsw-alias-label-dimmed)}
.dml_search:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));border-color:transparent}
.dml_searchClear{position:absolute;right:8px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;padding:0;display:flex}
.dml_cell,.dml_option,.dml_providerToggle{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:0;border-radius:var(--dsw-radius-sm);align-items:center;gap:8px;padding:6px 8px;font:inherit;font-size:13px;line-height:20px;display:flex}
.dml_cell:hover:not(:disabled),.dml_option:hover:not(:disabled),.dml_optionActive{background:var(--dsw-alias-interactive-bg-hover)}
.dml_option:disabled,.dml_cell:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dml_cellLabel{flex:none}
.dml_cellValue{color:var(--dsw-alias-label-caption);text-overflow:ellipsis;white-space:nowrap;min-width:0;margin-left:auto;overflow:hidden}
.dml_cellChevron{color:var(--dsw-alias-menu-icon);flex:none;margin-left:auto}
.dml_optionCopy{min-width:0;flex:1}
.dml_modelName{text-overflow:ellipsis;white-space:nowrap;font-weight:400;display:block;overflow:hidden}
.dml_check{flex:none;color:var(--dsw-alias-state-business-primary);display:flex;align-items:center}
.dml_selected{color:var(--dsw-alias-label-primary)}
.dml_provider{flex-direction:column;display:flex}
.dml_providerToggle{gap:6px;padding:4px 8px 4px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;line-height:16px}
.dml_providerToggle:hover:not(:disabled),.dml_providerToggle:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.dml_providerCaret{color:var(--dsw-alias-menu-icon);flex:none;transition:transform .12s}
.dml_providerOpen>.dml_providerToggle>.dml_providerCaret{transform:rotate(90deg)}
.dml_providerName{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dml_providerMeta{color:var(--dsw-alias-label-caption);flex:none;margin-left:auto;font-size:11px}
.dml_models{border-left:1px solid var(--dsw-alias-border-l1);flex-direction:column;margin-left:9px;display:flex}
.dml_models .dml_option{padding-left:13px}
.dml_dot{width:12px;height:12px;flex:none;border-radius:50%;border:1.5px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));border-top-color:transparent;animation:dml_spin .8s linear infinite}
@keyframes dml_spin{to{transform:rotate(360deg)}}
.dml_toast{transform:translate(-50%,-100%);position:fixed;z-index:1200;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;max-width:min(420px,100vw - 32px);display:flex;transition:opacity .2s,transform .2s}
.dml_toastLeave{opacity:0;transform:translate(-50%,calc(-100% + 4px))}
.dml_toastIcon{color:var(--dsw-alias-state-error-primary);flex:none;display:flex}
.dml_toastText{min-width:0}
`

    // 16px stroke icons on the currentColor, matching the host's outline icon
    // language. The trigger icon stays hidden by default through the same
    // `--dsh-composer-model-icon-display` variable the stock seat uses.
    const IconBase = ({ size = 16, className, children, ...rest }) =>
      h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          className,
          ...rest,
        },
        children,
      )
    const IconData = props =>
      h(
        IconBase,
        props,
        h('ellipse', { cx: 8, cy: 4.4, rx: 5, ry: 1.9 }),
        h('path', { d: 'M3 4.4v7.2c0 1.05 2.24 1.9 5 1.9s5-.85 5-1.9V4.4' }),
        h('path', { d: 'M3 8c0 1.05 2.24 1.9 5 1.9S13 9.05 13 8' }),
      )
    const IconChevronDown = props => h(IconBase, props, h('path', { d: 'M4 6.2 8 10.2 12 6.2' }))
    const IconChevronRight = props => h(IconBase, props, h('path', { d: 'M6.2 4 10.2 8 6.2 12' }))
    const IconCheck = props => h(IconBase, props, h('path', { d: 'M3.4 8.6 6.5 11.6 12.6 4.9' }))
    const IconWarning = props =>
      h(
        IconBase,
        props,
        h('path', { d: 'M8 2.7 14.3 13.3H1.7Z' }),
        h('path', { d: 'M8 6.6v3' }),
        h('path', { d: 'M8 11.4h.01' }),
      )
    const IconClose = props => h(IconBase, props, h('path', { d: 'M4.5 4.5 11.5 11.5' }), h('path', { d: 'M11.5 4.5 4.5 11.5' }))

    /** The stock `StateDot`'s ongoing state: a small spinning ring. */
    const BusyDot = () => h('span', { className: 'dml_dot' })

    const TOAST_TTL = 4000
    const TOAST_LEAVE = 200

    /**
     * The stock `Toast`: a transient message floated above the anchor (the
     * composer card), auto-dismissed after a few seconds with a short fade.
     * `anchor` is a DOM element or null; null centers on the viewport top.
     * @param text - the message.
     * @param icon - the leading icon element.
     * @param anchor - element to hover above, or null.
     * @param onDone - called after the leave transition finished.
     */
    function ComposerToast({ text, icon, anchor, onDone }) {
      const [leaving, setLeaving] = useState(false)
      const [pos, setPos] = useState(null)
      useEffect(() => {
        const hide = setTimeout(() => setLeaving(true), TOAST_TTL)
        return () => clearTimeout(hide)
      }, [])
      useEffect(() => {
        if (!leaving) return undefined
        const done = setTimeout(onDone, TOAST_LEAVE)
        return () => clearTimeout(done)
      }, [leaving, onDone])
      React.useLayoutEffect(() => {
        if (anchor === null || anchor === undefined || typeof anchor.getBoundingClientRect !== 'function') {
          setPos(null)
          return undefined
        }
        const place = () => {
          const rect = anchor.getBoundingClientRect()
          setPos({ left: rect.left + rect.width / 2, top: rect.top - 8 })
        }
        place()
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
      }, [anchor])
      return createPortal(
        h(
          'div',
          {
            className: clsx('dml_toast', leaving && 'dml_toastLeave'),
            style: pos === null ? { visibility: 'hidden', left: 0, top: 0 } : { left: pos.left, top: pos.top },
            role: 'status',
          },
          h('span', { className: 'dml_toastIcon' }, icon),
          h('span', { className: 'dml_toastText' }, text),
        ),
        document.body,
      )
    }

    // ── fuzzy ranking (self-hosted `rankByName`) ───────────────────────────────
    //
    // Same contract as the stock ranking: case-insensitive ordered subsequence
    // over the model name, ranked by prefix, alignment score, then catalog
    // order. With an empty query the catalog order is returned as-is.
    const WORD_BREAK = /[\s\-_/·.()]/
    function fuzzyScore(name, query) {
      const haystack = name.toLowerCase()
      let hit = 0
      let score = 0
      let previous = -2
      for (let at = 0; at < haystack.length && hit < query.length; at++) {
        if (haystack[at] !== query[hit]) continue
        if (at === previous + 1) score += 3 // contiguous run
        if (at === 0 || WORD_BREAK.test(haystack[at - 1])) score += 2 // word start
        if (hit === 0) score += at === 0 ? 4 : 1 // full-string prefix
        previous = at
        hit += 1
      }
      return hit === query.length ? score : -1
    }
    function rankByName(models, rawQuery) {
      const query = rawQuery.trim().toLowerCase()
      if (query === '') return [...models]
      const ranked = []
      for (let index = 0; index < models.length; index++) {
        const score = fuzzyScore(models[index].name, query)
        if (score >= 0) ranked.push({ model: models[index], index, score })
      }
      ranked.sort((left, right) => right.score - left.score || left.index - right.index)
      return ranked.map(entry => entry.model)
    }

    // ── provider order (same rule as the stock seat) ───────────────────────────
    function orderModelProviders(groups) {
      const rank = id => (id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2)
      return [...groups].sort((a, b) => rank(a.id) - rank(b.id))
    }

    /**
     * The shadowing seat. Renders the two-level menu with a provider-folded tree
     * for the model pane, labels the trigger `{provider}/{model} · {effort}`, and
     * shows each model row's exact id as its tooltip.
     *
     * `sessionId`, `available`, `directory`, `load`, and `select` arrive from this
     * entry's `inject` face (the same shared per-session store `/model` writes
     * through); `locked` is the owner's render-call prop; `renderSlot` is bound by
     * the slot runtime because this registration declares the official
     * `conversation.input.model.label` child slot; `t` is the entry's locale seat.
     */
    function ModelLabelSeat(props) {
      const { locked, available, directory: store, t, renderSlot } = props

      const state = React.useSyncExternalStore(
        useCallback(fn => store.subscribe(fn), [store]),
        useCallback(() => store.getSnapshot(), [store]),
      )

      const [open, setOpen] = useState(false)
      const [pane, setPane] = useState('root')
      const [query, setQuery] = useState('')
      const [highlightedKey, setHighlightedKey] = useState(null)
      // Only EXPLICIT folds live here: `providerId -> expanded`. A provider with
      // no entry follows the selection, so the tree needs no effect to stay in
      // step with a selection that changes elsewhere (the `/model` dialog, a
      // session switch, a catalog reload).
      const [expandedOverrides, setExpandedOverrides] = useState(() => new Map())
      const [selectionFocus, setSelectionFocus] = useState(false)
      const [toast, setToast] = useState(null)
      const toastSeq = useRef(0)
      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const searchRef = useRef(null)
      const menuRef = useRef(null)
      const [menuPos, setMenuPos] = useState(null)
      const itemRefs = useRef([])
      // Signature of the last scroll reveal, so folding the tree never re-scrolls
      // while a changed highlight, query, or pane still does.
      const lastRevealRef = useRef(null)
      const id = React.useId()

      const groups = useMemo(() => orderModelProviders(state.groups), [state.groups])
      const choices = useMemo(
        () =>
          groups.flatMap(group =>
            group.models.map(model => ({
              group,
              model,
              selection: {
                provider: group.id,
                model: model.id,
                ...(model.reasoning?.defaultEffort === undefined
                  ? {}
                  : { reasoningEffort: model.reasoning.defaultEffort }),
              },
            })),
          ),
        [groups],
      )
      const showSearch = choices.length > 4
      const searching = showSearch && query.trim() !== ''
      const filteredGroups = useMemo(
        () =>
          groups
            .map(group => ({
              ...group,
              models: rankByName(group.models, searching ? query.trim() : ''),
            }))
            .filter(group => group.models.length > 0),
        [groups, query, showSearch, searching],
      )

      const providerName = useCallback(
        group => (group.id === 'deepseek-account' ? t('provider.account') : group.name),
        [t],
      )

      // ── the official label child slot ───────────────────────────────────────
      //
      // The registration declares `conversation.input.model.label` exactly as the
      // shipped seat does, so the slot runtime binds `renderSlot` into this
      // component. Routing every model name through it keeps the official label
      // decorations (the 1017 release badge today) working inside this seat;
      // with no occupant the outlet renders our fallback, the plain catalog
      // name — identical to the old self-rendered label.
      const labelInner = useCallback(
        (group, model, placement, selected) => {
          if (typeof renderSlot !== 'function') return model.name
          return renderSlot(
            'conversation.input.model.label',
            {
              provider: { id: group.id, name: providerName(group) },
              model: { id: model.id, name: model.name },
              placement,
              selected,
            },
            { fallback: model.name },
          )
        },
        [renderSlot, providerName],
      )

      /** The provider-qualified trigger/cell label: `{providerName}/{labelSlot}`. */
      const qualifiedLabel = useCallback(
        (group, model, placement, selected) =>
          h(Fragment, null, `${providerName(group)}/`, labelInner(group, model, placement, selected)),
        [providerName, labelInner],
      )

      // ── the folded tree ─────────────────────────────────────────────────────
      //
      // A provider is open when the user opened it and closed when the user
      // closed it. With no explicit choice it opens only if it owns the current
      // selection (or, with nothing selected yet, if it is the first one listed);
      // while a search is active every provider opens instead, because a folded
      // match would otherwise be invisible.
      const currentProviderId = state.current?.provider ?? null
      const defaultOpenProviderId = currentProviderId ?? filteredGroups[0]?.id ?? null
      const isProviderOpen = useCallback(
        providerId => {
          const override = expandedOverrides.get(providerId)
          if (override !== undefined) return override
          return searching || providerId === defaultOpenProviderId
        },
        [expandedOverrides, defaultOpenProviderId, searching],
      )
      const toggleProvider = useCallback(
        providerId => {
          setExpandedOverrides(previous => {
            const next = new Map(previous)
            const current = previous.get(providerId) ?? (searching || providerId === defaultOpenProviderId)
            next.set(providerId, !current)
            return next
          })
        },
        [defaultOpenProviderId, searching],
      )

      // One flat row list: provider toggles and the model rows they unfold. The
      // keyboard walk, the tab walk, and the highlight all address this list, so
      // a folded provider simply removes its models from every walk at once.
      const rows = useMemo(() => {
        const out = []
        for (const group of filteredGroups) {
          const expanded = isProviderOpen(group.id)
          out.push({ kind: 'provider', key: `p:${group.id}`, group, expanded })
          if (!expanded) continue
          for (const model of group.models) {
            out.push({ kind: 'model', key: `m:${group.id}/${model.id}`, group, model })
          }
        }
        return out
      }, [filteredGroups, isProviderOpen])

      const rowIndexOf = key => (key === null || key === undefined ? -1 : rows.findIndex(row => row.key === key))
      const currentRowKey =
        state.current === null
          ? undefined
          : rows.find(
              row =>
                row.kind === 'model' &&
                row.group.id === state.current.provider &&
                row.model.id === state.current.model,
            )?.key
      const highlightedIndex = rowIndexOf(highlightedKey)
      const fallbackIndex = rowIndexOf(currentRowKey)
      const activeRowIndex =
        rows.length === 0 ? -1 : highlightedIndex >= 0 ? highlightedIndex : fallbackIndex >= 0 ? fallbackIndex : 0
      const activeRow = activeRowIndex < 0 ? undefined : rows[activeRowIndex]
      const activeDescendant =
        activeRow === undefined
          ? undefined
          : activeRow.kind === 'model'
            ? `${id}-model-${activeRowIndex}`
            : `${id}-provider-${activeRowIndex}`

      const currentChoice =
        choices[
          state.current === null
            ? -1
            : choices.findIndex(
                c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model,
              )
        ]
      const reasoning = currentChoice?.model.reasoning
      const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
      const effortLabel =
        reasoning === undefined
          ? state.retainedEffort
          : effectiveEffort === undefined
            ? t('effort.providerDefault')
            : (reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort)
      const effortChoices = useMemo(
        () =>
          reasoning === undefined
            ? []
            : [
                ...(reasoning.defaultEffort === undefined
                  ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
                  : []),
                ...reasoning.efforts.map(effort => ({
                  key: `effort:${effort.id}`,
                  effort: effort.id,
                  label: effort.name,
                })),
              ],
        [reasoning, t],
      )
      const pending = state.pending
      const busy = pending !== null

      const load = useCallback(() => {
        try {
          props.load()
        } catch {
          /* the store's own error surface reports a failed catalog load */
        }
      }, [props])

      const reload = load

      const select = useCallback(
        selection => {
          try {
            return Promise.resolve(props.select(selection))
          } catch (error) {
            return Promise.resolve({
              ok: false,
              error: { code: 'local', message: String(error?.message ?? error) },
            })
          }
        },
        [props],
      )

      // Outside-click and Escape dismissal.
      useEffect(() => {
        if (!open) return undefined
        const closeOutside = event => {
          if (rootRef.current?.contains(event.target) === true) return
          if (menuRef.current?.contains(event.target) === true) return
          setOpen(false)
        }
        document.addEventListener('mousedown', closeOutside)
        return () => document.removeEventListener('mousedown', closeOutside)
      }, [open])

      // Reveal the row the keyboard is on, and the saved selection whenever the
      // pane or the query changes, but NEVER merely because the tree was folded.
      //
      // Folding rewrites `rows`, so an effect keyed on that rewrite scrolled to
      // the stale "active" row, which is row 0 as soon as the selection's own
      // provider is folded away (neither the highlight nor the selection is in
      // `rows` any more). That yanked the viewport back to the top on every
      // toggle, so the user had to scroll down again to see what they had just
      // unfolded. The signature below deliberately excludes `rows`: a fold
      // changes the list, never the reason to scroll.
      const revealSignature = `${open}|${pane}|${query}|${highlightedKey ?? ''}`
      React.useLayoutEffect(() => {
        if (!open || pane !== 'model') {
          lastRevealRef.current = null
          return
        }
        if (revealSignature === lastRevealRef.current) return
        lastRevealRef.current = revealSignature
        // Prefer the highlight, then the saved selection, then the first model
        // row — never a bare provider toggle, which would leave the matching
        // model it unfolds just below the fold.
        const target =
          highlightedKey ??
          currentRowKey ??
          rows.find(row => row.kind === 'model')?.key ??
          rows[0]?.key
        if (target === undefined) return
        const index = rows.findIndex(row => row.key === target)
        if (index < 0) return
        itemRefs.current[index]?.scrollIntoView({ block: 'nearest' })
      }, [revealSignature, open, pane, query, highlightedKey, rows, currentRowKey])

      // Place the fixed-position menu above the trigger, clamped to the viewport.
      React.useLayoutEffect(() => {
        if (!open) {
          setMenuPos(null)
          return undefined
        }
        const place = () => {
          const rect = triggerRef.current?.getBoundingClientRect()
          if (rect === undefined) return
          const MARGIN = 12
          const lw = menuRef.current?.offsetWidth ?? 0
          const lh = menuRef.current?.offsetHeight ?? 0
          let x = rect.right - lw
          let y = rect.top - 8 - lh
          if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN)
          if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN)
          setMenuPos({ left: x, top: y })
        }
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return () => {
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open, pane, state, query, expandedOverrides])

      if (!available) return null

      const show = () => {
        setSelectionFocus(false)
        triggerRef.current?.focus()
        setQuery('')
        setHighlightedKey(null)
        setPane(state.current === null ? 'model' : 'root')
        setOpen(true)
        load()
      }
      const close = (restoreFocus = false) => {
        setOpen(false)
        setPane('root')
        if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
      }
      const closeAfterSelection = () => {
        setSelectionFocus(true)
        close(true)
      }
      const drill = next => {
        setQuery('')
        setHighlightedKey(null)
        setPane(next)
      }
      const back = () => setPane('root')

      const choose = selection => {
        if (state.current?.provider === selection.provider && state.current.model === selection.model) {
          closeAfterSelection()
          return
        }
        submit(selection)
      }
      const chooseEffort = effort => {
        if (state.current === null) return
        if (effectiveEffort === effort) {
          closeAfterSelection()
          return
        }
        submit({
          provider: state.current.provider,
          model: state.current.model,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
        })
      }

      const settleSelection = result => {
        if (result === undefined) return
        if (result.ok) {
          if (rootRef.current !== null) closeAfterSelection()
          return
        }
        const { error } = result
        toastSeq.current += 1
        setToast({
          seq: toastSeq.current,
          text:
            error.code === 'session/writer-held'
              ? t('error.sessionInUse')
              : t('error.action', { message: `${error.code}: ${error.message}` }),
        })
      }
      const submit = selection => {
        setSelectionFocus(true)
        triggerRef.current?.focus()
        select(selection).then(settleSelection)
      }

      // ── labels: the whole point of this plugin ──────────────────────────────
      const waiting = state.current === null && state.status === 'loading'

      /**
       * Spell one selection as `{providerName}/{modelName}` using the catalog's
       * display names, e.g. `火山方舟/DeepSeek V4.1 Flash`.
       *
       * The raw ids are only a fallback for a selection whose catalog entry is
       * gone (provider removed, model retired, account signed out): the user
       * still needs to see which selection is saved, and the id is then the only
       * name that exists.
       *
       * @param providerId - provider id from the directory.
       * @param modelId - provider-owned model id.
       * @returns the label fragment as plain text (for titles and aria).
       */
      const spell = (providerId, modelId) => {
        const group = groups.find(candidate => candidate.id === providerId)
        const model = group?.models.find(candidate => candidate.id === modelId)
        if (group === undefined || model === undefined) return `${providerId}/${modelId}`
        return `${providerName(group)}/${model.name}`
      }

      const selectionLabel =
        state.current === null
          ? waiting
            ? t('trigger.loading')
            : t('trigger.fallback')
          : spell(state.current.provider, state.current.model)
      const triggerLabel = effortLabel === undefined ? selectionLabel : `${selectionLabel} · ${effortLabel}`
      const triggerAria = waiting
        ? t('trigger.loading')
        : state.current === null
          ? t('trigger.selectAria')
          : effortLabel === undefined
            ? t('trigger.aria', { model: selectionLabel })
            : t('trigger.ariaEffort', { model: selectionLabel, effort: effortLabel })

      itemRefs.current = []
      let itemIndex = 0
      const itemRef = () => {
        const at = itemIndex++
        return node => {
          itemRefs.current[at] = node
        }
      }

      const moveFocus = offset => {
        const items = itemRefs.current.filter(item => item !== null && !item.disabled)
        if (items.length === 0) return
        const active = items.findIndex(item => item === document.activeElement)
        items[
          active === -1 ? (offset > 0 ? 0 : items.length - 1) : (active + offset + items.length) % items.length
        ]?.focus()
      }

      // Activate whatever the highlight sits on: a model selects it, a provider
      // folds or unfolds its subtree. Folding stays available while a selection
      // is in flight — it changes nothing but this menu's own layout.
      const activateHighlighted = () => {
        const row = rows[activeRowIndex]
        if (row === undefined) return
        if (row.kind === 'provider') toggleProvider(row.group.id)
        else if (!busy) choose({ provider: row.group.id, model: row.model.id })
      }

      const onRootKeyDown = event => {
        if (event.nativeEvent?.isComposing) return
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          if (pane !== 'root' && state.current !== null) back()
          else close(true)
          return
        }
        if (!open) return
        if (pane === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          if (!busy && rows.length > 0) {
            const next =
              (Math.max(0, activeRowIndex) + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
            setHighlightedKey(rows[next].key)
            searchRef.current?.focus()
          }
          return
        }
        if (
          pane === 'model' &&
          showSearch &&
          event.target instanceof HTMLInputElement &&
          (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))
        ) {
          if (event.key === 'Tab' && rows.length === 0) return
          event.preventDefault()
          activateHighlighted()
          return
        }
        if (event.key === 'Tab') {
          if (event.shiftKey) {
            event.preventDefault()
            if (pane !== 'root' && state.current !== null) back()
            else close(true)
            return
          }
          const focused = document.activeElement
          const items = itemRefs.current.filter(item => item !== null)
          if (focused instanceof HTMLButtonElement && items.includes(focused)) {
            event.preventDefault()
            focused.click()
            return
          }
          if (focused !== triggerRef.current) return
          event.preventDefault()
          if (pane === 'model' && showSearch) {
            setHighlightedKey(null)
            searchRef.current?.focus()
            return
          }
          ;(
            menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])') ??
            items.find(item => !item.disabled)
          )?.focus()
          return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          moveFocus(event.key === 'ArrowDown' ? 1 : -1)
        }
      }

      const onBlur = event => {
        if (
          event.relatedTarget instanceof Node &&
          (rootRef.current?.contains(event.relatedTarget) === true ||
            menuRef.current?.contains(event.relatedTarget) === true)
        ) {
          return
        }
        close()
      }

      return h(
        'div',
        {
          ref: rootRef,
          className: 'dml_root',
          onKeyDown: onRootKeyDown,
          onBlur,
          onMouseDown: event => {
            if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault()
          },
        },
        h(
          'button',
          {
            ref: triggerRef,
            type: 'button',
            className: 'dml_trigger',
            'aria-label': triggerAria,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-controls': open ? `${id}-menu` : undefined,
            title: triggerLabel,
            'aria-busy': busy,
            'data-selection-focus': selectionFocus ? '' : undefined,
            onBlur: () => setSelectionFocus(false),
            disabled: locked,
            onClick: () => {
              if (open) close(true)
              else show()
            },
          },
          h(IconData, { className: 'dml_triggerIcon', size: 16 }),
          h(
            'span',
            { className: 'dml_triggerLabel' },
            currentChoice === undefined
              ? selectionLabel
              : qualifiedLabel(currentChoice.group, currentChoice.model, 'trigger', true),
          ),
          effortLabel !== undefined && h('span', { className: 'dml_triggerEffort' }, effortLabel),
          busy
            ? h(BusyDot, null)
            : h(IconChevronDown, { className: clsx('dml_chevron', open && 'dml_chevronOpen') }),
        ),
        open &&
          createPortal(
            h(
              'div',
              {
                ref: menuRef,
                id: `${id}-menu`,
                className: 'dml_menu',
                style: menuPos ?? { visibility: 'hidden', left: 0, top: 0 },
                role: pane === 'model' ? 'group' : 'menu',
                'aria-label': t('menu.aria'),
                'aria-busy': state.status === 'loading' || busy,
              },
              pane === 'root' &&
                h(
                  Fragment,
                  null,
                  h(
                    'button',
                    {
                      ref: itemRef(),
                      type: 'button',
                      role: 'menuitem',
                      className: 'dml_cell',
                      onClick: () => drill('model'),
                    },
                    h('span', { className: 'dml_cellLabel' }, t('menu.model')),
                    h(
                      'span',
                      { className: 'dml_cellValue' },
                      currentChoice === undefined
                        ? selectionLabel
                        : qualifiedLabel(currentChoice.group, currentChoice.model, 'menu', true),
                    ),
                    h(IconChevronRight, { className: 'dml_cellChevron' }),
                  ),
                  reasoning !== undefined &&
                    h(
                      'button',
                      {
                        ref: itemRef(),
                        type: 'button',
                        role: 'menuitem',
                        className: 'dml_cell',
                        onClick: () => drill('effort'),
                      },
                      h('span', { className: 'dml_cellLabel' }, t('menu.effort')),
                      h('span', { className: 'dml_cellValue' }, effortLabel),
                      h(IconChevronRight, { className: 'dml_cellChevron' }),
                    ),
                ),
              pane === 'model' &&
                h(
                  Fragment,
                  null,
                  showSearch &&
                    h(
                      'div',
                      { className: 'dml_searchRow' },
                      h('input', {
                        ref: searchRef,
                        className: 'dml_search',
                        type: 'text',
                        role: 'searchbox',
                        'aria-label': t('search.placeholder'),
                        'aria-controls': `${id}-models`,
                        'aria-activedescendant': activeDescendant,
                        placeholder: t('search.placeholder'),
                        value: query,
                        readOnly: busy,
                        onChange: event => {
                          setQuery(event.target.value)
                          setHighlightedKey(null)
                        },
                      }),
                      query !== '' &&
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dml_searchClear',
                            'aria-label': t('search.clear'),
                            disabled: busy,
                            onClick: () => {
                              setQuery('')
                              searchRef.current?.focus()
                            },
                          },
                          h(IconClose, {}),
                        ),
                    ),
                  state.status === 'loading' && h('div', { className: 'dml_status' }, t('status.loading')),
                  state.error !== null &&
                    h(
                      'div',
                      { className: 'dml_error' },
                      h('span', null, t('error.action', { message: state.error })),
                      h('button', { type: 'button', className: 'dml_retry', onClick: reload }, t('action.reload')),
                    ),
                  state.failures.map(failure =>
                    h(
                      'div',
                      { className: 'dml_warning', key: failure.id },
                      h(
                        'span',
                        null,
                        t('warning.groupLoad', {
                          name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name,
                          message: failure.message,
                        }),
                      ),
                      h('button', { type: 'button', className: 'dml_retry', onClick: reload }, t('action.reload')),
                    ),
                  ),
                  h(
                    'div',
                    {
                      id: `${id}-models`,
                      className: 'dml_groups scrollable',
                      role: 'menu',
                      'aria-label': t('menu.model'),
                      hidden: filteredGroups.length === 0,
                    },
                    filteredGroups.map(group => {
                      const expanded = isProviderOpen(group.id)
                      const name = providerName(group)
                      const sectionId = `${id}-models-${group.id}`
                      const providerRowIndex = itemIndex
                      const providerRef = itemRef()
                      return h(
                        'div',
                        { key: group.id, className: clsx('dml_provider', expanded && 'dml_providerOpen') },
                        h(
                          'button',
                          {
                            ref: providerRef,
                            type: 'button',
                            role: 'menuitem',
                            className: 'dml_providerToggle',
                            id: `${id}-provider-${providerRowIndex}`,
                            'aria-expanded': expanded,
                            'aria-controls': sectionId,
                            'aria-label': t(expanded ? 'provider.collapse' : 'provider.expand', { name }),
                            onClick: () => toggleProvider(group.id),
                          },
                          h(IconChevronRight, { className: 'dml_providerCaret', size: 12 }),
                          h('span', { className: 'dml_providerName' }, name),
                          h(
                            'span',
                            { className: 'dml_providerMeta' },
                            t('provider.count', { count: group.models.length }),
                          ),
                        ),
                        expanded &&
                          h(
                            'div',
                            { id: sectionId, className: 'dml_models', role: 'group', 'aria-label': name },
                            group.models.map(model => {
                              const rowIndex = itemIndex
                              const selected =
                                state.current?.provider === group.id && state.current.model === model.id
                              return h(
                                'button',
                                {
                                  key: model.id,
                                  ref: itemRef(),
                                  type: 'button',
                                  role: 'menuitemradio',
                                  'aria-checked': selected,
                                  id: `${id}-model-${rowIndex}`,
                                  tabIndex: showSearch ? -1 : 0,
                                  onFocus: () => setHighlightedKey(`m:${group.id}/${model.id}`),
                                  'data-highlighted': rowIndex === activeRowIndex ? '' : undefined,
                                  className: clsx(
                                    'dml_option',
                                    'dml_modelRow',
                                    selected && 'dml_selected',
                                    rowIndex === activeRowIndex && 'dml_optionActive',
                                  ),
                                  onMouseMove:
                                    busy || rowIndex === activeRowIndex
                                      ? undefined
                                      : () => {
                                          if (showSearch) setHighlightedKey(`m:${group.id}/${model.id}`)
                                          else itemRefs.current[rowIndex]?.focus()
                                        },
                                  title: spell(group.id, model.id),
                                  disabled: busy,
                                  onClick: () => choose({ provider: group.id, model: model.id }),
                                },
                                h(
                                  'span',
                                  { className: 'dml_optionCopy' },
                                  h(
                                    'span',
                                    { className: 'dml_modelName' },
                                    labelInner(group, model, 'option', selected),
                                  ),
                                ),
                                h(
                                  'span',
                                  { className: 'dml_check' },
                                  pending?.provider === group.id && pending.model === model.id
                                    ? h(BusyDot, null)
                                    : selected
                                      ? h(IconCheck, {})
                                      : null,
                                ),
                              )
                            }),
                          ),
                      )
                    }),
                  ),
                  state.status === 'ready' &&
                    filteredGroups.length === 0 &&
                    h(
                      'div',
                      { className: 'dml_empty', role: 'status' },
                      t(choices.length === 0 ? 'empty.models' : 'search.empty'),
                    ),
                ),
              pane === 'effort' &&
                h(
                  Fragment,
                  null,
                  state.error !== null &&
                    h(
                      'div',
                      { className: 'dml_error' },
                      h('span', null, t('error.action', { message: state.error })),
                      h('button', { type: 'button', className: 'dml_retry', onClick: reload }, t('action.reload')),
                    ),
                  effortChoices.length === 0
                    ? h('div', { className: 'dml_empty' }, t('empty.efforts'))
                    : effortChoices.map(level =>
                        h(
                          'button',
                          {
                            key: level.key,
                            ref: itemRef(),
                            type: 'button',
                            role: 'menuitemradio',
                            'aria-checked': effectiveEffort === level.effort,
                            className: clsx('dml_option', effectiveEffort === level.effort && 'dml_selected'),
                            disabled: busy,
                            onClick: () => chooseEffort(level.effort),
                          },
                          h(
                            'span',
                            { className: 'dml_optionCopy' },
                            h('span', { className: 'dml_modelName' }, level.label),
                          ),
                          h(
                            'span',
                            { className: 'dml_check' },
                            pending !== null &&
                              pending.provider === state.current?.provider &&
                              pending.model === state.current.model &&
                              pending.reasoningEffort === level.effort
                              ? h(BusyDot, null)
                              : effectiveEffort === level.effort
                                ? h(IconCheck, {})
                                : null,
                          ),
                        ),
                      ),
                ),
            ),
            document.body,
          ),
        toast !== null &&
          h(ComposerToast, {
            key: toast.seq,
            text: toast.text,
            icon: h(IconWarning, {}),
            anchor: rootRef.current?.closest('[data-composer-card]') ?? null,
            onDone: () => setToast(null),
          }),
      )
    }

    // ── plugin wiring ─────────────────────────────────────────────────────────
    //
    // `remote` and `remote.session` are required, not optional: the Cordis
    // Service proxy rebinds `this.ctx` to the CALLER's context at call time, and
    // `modelDirectories.directoryFor()` reads `this.ctx.remote.session` inside.
    // Without these two declarations that call throws
    // `cannot get property "remote.session" without inject`, the entry abdicates,
    // and the composer silently falls back to the shipped seat. The shipped
    // ui-model-selection declares the same pair for the same reason.
    const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.session']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-model-label: dictionaries')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-model-label')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-model-label: styles')

      // `conversation.input.model` is a `single` Slot: entries sort by ascending
      // `priority` and the first wins the cell. A negative priority therefore
      // shadows the shipped seat without disabling it.
      //
      // The registration waits on `modelDirectories` — the service the shipped
      // seat also reads — so this entry never resolves a session's directory
      // before that service exists. `remote`/`remote.session` are listed here as
      // well as at the top level on purpose: the inject face below calls
      // `directoryFor()`, which reads `ctx.remote.session` through the caller's
      // context, so the dependency is declared exactly where it is consumed.
      // `locale: NS` gives the component its `t` seat; the inject face hands it
      // the same shared store `/model` writes through, so the two surfaces can
      // never disagree.
      //
      // `children` declares the official `conversation.input.model.label` child
      // slot with the exact spec the shipped seat declares. The declaration is
      // what binds `renderSlot` into the component, and the slot itself is the
      // sanctioned extension point official label decorations register into.
      ctx.inject(['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'], scope => {
        const models = scope.modelDirectories
        const sessions = scope.sessions
        scope.slots.inject('conversation.input.model', () =>
          scope.slots.register(
            {
              name: 'conversation.input.model',
              priority: -100,
              locale: NS,
              children: { 'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true } },
              inject: sessionId => {
                const available = sessions.subagentAddress(sessionId) === undefined
                const directory = models.directoryFor(sessionId)
                return {
                  sessionId,
                  available,
                  directory: directory.store,
                  load: () => {
                    if (available) directory.load().catch(() => {})
                  },
                  select: selection => (available ? directory.select(selection) : Promise.resolve(undefined)),
                }
              },
            },
            ModelLabelSeat,
          ),
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dsh-model-label'

    return module.exports
  },
})
