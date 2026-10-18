/**
 * Real React + jsdom render check for dsh-model-label's tree picker.
 *
 * The headless check stubs React and therefore cannot observe a single state
 * transition. This harness mounts the real seat with react-dom/client, clicks
 * the real DOM, and asserts the folded-tree behaviour end to end:
 *
 *   - only the provider owning the selection starts open
 *   - clicking a provider toggles only that subtree
 *   - a search unfolds providers with matches
 *   - selecting a model reaches the shared directory with the right ids
 *   - the trigger still reads `{providerName}/{modelName} · {effort}`
 *
 * Run with any Node.js >= 18, after installing the dev-only peers once:
 *   npm install
 *   node _render-check.cjs
 */
const path = require('node:path')
const fs = require('node:fs')

// react / react-dom / jsdom are NOT plugin dependencies — the shell provides
// React at runtime. They are devDependencies of this repo, needed only by this
// check, so resolve them from this directory's local install.
const PEER_ROOTS = [__dirname]
const resolveModule = name => {
  for (const base of PEER_ROOTS) {
    try {
      return require.resolve(name, { paths: [base] })
    } catch {
      /* try the next root */
    }
  }
  throw new Error(`render check needs ${name}; install the devDependencies with: npm install`)
}

const { JSDOM } = require(resolveModule('jsdom'))

// ── a DOM before anything requires react-dom ────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
})
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator
global.HTMLElement = dom.window.HTMLElement
global.HTMLButtonElement = dom.window.HTMLButtonElement
global.HTMLInputElement = dom.window.HTMLInputElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.Event = dom.window.Event
global.MouseEvent = dom.window.MouseEvent
global.KeyboardEvent = dom.window.KeyboardEvent
global.IS_REACT_ACT_ENVIRONMENT = true

// jsdom implements no layout, so it ships no scrollIntoView; the seat (like the
// shipped picker) calls it to keep the highlighted row visible. Record every
// call: an unexpected one is exactly the "viewport jumped to the top" symptom,
// because it targets whatever row the seat believes is active.
const scrollCalls = []
dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {
  scrollCalls.push({
    className: this.className,
    text: this.textContent,
  })
}
const takeScrollCalls = () => {
  const calls = scrollCalls.slice()
  scrollCalls.length = 0
  return calls
}

// ── a deterministic box model ───────────────────────────────────────────────
//
// jsdom lays nothing out: every offset* is 0, which makes the seat's size-lock
// short-circuit and its position math a no-op. Give the menu and the trigger a
// modelled geometry instead — a trigger pinned to the composer's bottom-right
// corner and a menu whose NATURAL size shrinks with its visible rows — so the
// "the menu box must not flash while typing" regression has something to assert
// against. The model is deliberately simple: width = longest visible row,
// height = row-count dependent. Anything less and the lock could pass
// vacuously.
const ROW_H = 28
const HEADER_H = 70 // search row + padding of the model pane
const boxModel = {
  trigger: { right: 600, top: 400, width: 200 }, // composer-bottom-right seat
  viewport: { width: 1440, height: 900 },
}
dom.window.Element.prototype.getBoundingClientRect = function () {
  if (this.classList?.contains('dml_trigger')) {
    const t = boxModel.trigger
    return {
      left: t.right - t.width,
      right: t.right,
      top: t.top,
      bottom: t.top + 28,
      width: t.width,
      height: 28,
    }
  }
  return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }
}
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    if (!this.classList?.contains('dml_menu')) return 0
    // The menu is max-content wide: the longest visible label (a provider name
    // or a model row) sets the width, clamped exactly like the CSS. Derived
    // from the live DOM, so a search that drops long-named rows naturally
    // narrows the box — which is the flash the size lock must prevent.
    let longest = 0
    for (const node of this.querySelectorAll('.dml_providerName, .dml_modelName, .dml_cellValue')) {
      longest = Math.max(longest, node.textContent.length)
    }
    return Math.min(Math.max(longest * 7 + 48, 240), 420)
  },
})
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    if (!this.classList?.contains('dml_menu')) return 0
    // Header chrome plus one row height per VISIBLE row: provider toggles and
    // the model rows they unfold. Folding or filtering removes rows, so the
    // natural height shrinks with them — again, only if the lock fails.
    const rows = this.querySelectorAll('.dml_providerToggle, .dml_modelRow, .dml_cell').length
    return Math.min(HEADER_H + rows * ROW_H, 360)
  },
})
Object.defineProperty(dom.window, 'innerWidth', { configurable: true, get: () => boxModel.viewport.width })
Object.defineProperty(dom.window, 'innerHeight', { configurable: true, get: () => boxModel.viewport.height })
const readMenuBox = () => {
  const menu = document.querySelector('.dml_menu')
  if (menu === null) return null
  const style = menu.getAttribute('style') ?? ''
  const num = name => {
    const m = style.match(new RegExp(`${name}:\\s*([\\d.]+)px`))
    return m === null ? null : Number(m[1])
  }
  return { left: num('left'), top: num('top'), width: num('width'), height: num('height') }
}

const React = require(resolveModule('react'))
const ReactDOM = require(resolveModule('react-dom/client'))
const { act } = require(resolveModule('react'))

// The refactor self-hosts every control the stock seat borrowed from
// `dsh-client-ui-primitives`, so the platform table is react/react-dom only —
// and the require stub FAILS if the bundle ever reaches for `@deepseek-ai/*`
// again.

// A stand-in for the official `conversation.input.model.label` occupant (the
// 1017 badge ships there): it marks every label the seat routes through the
// slot so the checks can see the official decoration surface light up.
const officialLabelSlots = []
const officialLabel = (key, owner, opts) => {
  officialLabelSlots.push({ key, placement: owner.placement, provider: owner.provider, model: owner.model })
  return React.createElement('span', { 'data-official-label': owner.placement }, opts?.fallback ?? owner.model?.name)
}

const platformModules = {
  react: React,
  'react/jsx-runtime': { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment },
  'react-dom': require(resolveModule('react-dom')),
}

// ── load the bundle exactly as the ModuleLoader would ───────────────────────
const source = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8')

let loaded = null
// The bundle reads `window` (the global) inside its factory, so the loader
// handle must live on the very same object the seat sees.
dom.window.__ModuleLoader__ = { load: spec => (loaded = spec) }
new Function('window', 'require', source)(dom.window, spec => {
  if (spec in platformModules) return platformModules[spec]
  throw new Error(`unexpected require("${spec}")`)
})
const exportsObj = loaded.factory(spec => {
  if (spec in platformModules) return platformModules[spec]
  throw new Error(`unexpected factory require("${spec}")`)
})

// ── catalog: two providers, the selection living in the SECOND one ──────────
const state = {
  current: { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' },
  routable: true,
  groups: [
    {
      id: 'deepseek-account',
      name: 'DeepSeek Account',
      models: [
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'deepseek-v4.1', name: 'DeepSeek V4.1' },
      ],
    },
    {
      id: 'volcengine',
      name: '火山方舟',
      models: [
        { id: 'glm-5.3', name: 'GLM 5.3', reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'kimi-k2', name: 'Kimi K2' },
      ],
    },
    { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'qwen3-max', name: 'Qwen3 Max' }] },
  ],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
  retainedEffort: 'High',
}
const store = { getSnapshot: () => state, subscribe: () => () => {} }

const selections = []
let registered = null
const fakeCtx = {
  effect: fn => {
    const d = fn()
    return typeof d === 'function' ? d : () => {}
  },
  inject: (services, cb) =>
    cb({
      slots: {
        inject: (slot, register) => register(),
        register: (meta, component) => {
          registered = { meta, component }
          return () => {}
        },
      },
      modelDirectories: {
        directoryFor: () => ({
          store,
          load: async () => state,
          select: async selection => {
            selections.push(selection)
            return { ok: true }
          },
        }),
      },
      sessions: { subagentAddress: () => undefined },
    }),
  get: () => undefined,
  locale: { register: () => () => {}, bind: () => key => key },
}
exportsObj.apply(fakeCtx)

const t = (key, params) => {
  const template = DICT[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
}

// The plugin's own Chinese dictionary, read back out of the bundle so this
// harness never drifts from the shipped strings. The match is anchored on the
// DICT opener and closed by the following section banner, so re-indenting or
// appending entries inside DICT cannot break the extraction.
const DICT = (() => {
  const match = source.match(/const DICT = \{([\s\S]*?)\n    \}\n\n    \/\/ ──/)
  if (match === null) throw new Error('could not read DICT out of the bundle')
  // eslint-disable-next-line no-new-func
  return new Function(`const DICT = {${match[1]}\n}\nreturn DICT`)().zh
})()
const face = registered.meta.inject('session-1')
const seatProps = { locked: false, t, renderSlot: officialLabel, ...face }

// ── mount ───────────────────────────────────────────────────────────────────
const host = document.getElementById('host')
let root = null
act(() => {
  root = ReactDOM.createRoot(host)
  root.render(React.createElement(registered.component, seatProps))
})

const results = []
const check = (label, ok, detail = '') => results.push({ label, ok, detail })

const trigger = () => document.querySelector('.dml_trigger')
const menu = () => document.querySelector('.dml_menu')
const providerToggles = () => [...document.querySelectorAll('.dml_providerToggle')]
const providerLabels = () => providerToggles().map(node => node.querySelector('.dml_providerName').textContent)
const expandedProviders = () =>
  providerToggles()
    .filter(node => node.getAttribute('aria-expanded') === 'true')
    .map(node => node.querySelector('.dml_providerName').textContent)
const modelRows = () => [...document.querySelectorAll('.dml_option.dml_modelRow')]
const modelNames = () => modelRows().map(node => node.querySelector('.dml_modelName').textContent)

const click = node =>
  act(() => {
    node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })

// Open the seat and drill from the root pane into the model pane. With a
// selection already saved the seat opens on `root`, exactly like the shipped one.
const openModelPane = () => {
  click(trigger())
  const modelCell = [...document.querySelectorAll('.dml_cell')].find(n =>
    n.textContent.includes(DICT['menu.model']),
  )
  if (modelCell !== undefined && modelCell !== null) click(modelCell)
}

check('trigger renders the provider-qualified label', trigger().textContent.includes('火山方舟/GLM 5.3'), trigger().textContent)
check(
  'the trigger label routes through the official label slot',
  document.querySelector('.dml_trigger [data-official-label="trigger"]') !== null,
)
// The menu opens on the ROOT pane (a selection is saved); assert the Model
// cell's slot routing BEFORE drilling into the model pane, which unmounts it.
click(trigger())
check(
  'the Model cell routes through the official label slot',
  [...document.querySelectorAll('.dml_cell [data-official-label="menu"]')].length === 1,
)
const modelCell = [...document.querySelectorAll('.dml_cell')].find(n => n.textContent.includes(DICT['menu.model']))
if (modelCell !== undefined && modelCell !== null) click(modelCell)
check('menu opens on the model pane', menu() !== null && providerToggles().length > 0)
check(
  'every visible model row routes through the official label slot',
  document.querySelectorAll('.dml_modelRow [data-official-label="option"]').length === modelRows().length &&
    modelRows().length > 0,
  `rows=${modelRows().length}`,
)

// ── default fold state ──────────────────────────────────────────────────────
check(
  'lists every provider as a toggle',
  JSON.stringify(providerLabels()) === JSON.stringify(['DeepSeek 账号', '火山方舟', 'OpenRouter']),
  JSON.stringify(providerLabels()),
)
check(
  'only the provider owning the selection starts open',
  JSON.stringify(expandedProviders()) === JSON.stringify(['火山方舟']),
  JSON.stringify(expandedProviders()),
)
check(
  'a folded provider contributes no model rows',
  JSON.stringify(modelNames()) === JSON.stringify(['GLM 5.3', 'Kimi K2']),
  JSON.stringify(modelNames()),
)
check(
  'every provider toggle reports its model count',
  providerToggles()[0].querySelector('.dml_providerMeta').textContent ===
    t('provider.count', { count: 2 }),
  providerToggles()[0].querySelector('.dml_providerMeta').textContent,
)
check(
  'the selected model row is marked checked',
  modelRows().some(n => n.getAttribute('aria-checked') === 'true' && n.textContent.includes('GLM 5.3')),
)

// ── opening a second provider does not close the first ──────────────────────
click(providerToggles()[0])
check(
  'opening another provider keeps the selection provider open',
  JSON.stringify(expandedProviders()) === JSON.stringify(['DeepSeek 账号', '火山方舟']),
  JSON.stringify(expandedProviders()),
)
check(
  'the newly opened subtree shows its models',
  modelNames().includes('DeepSeek V4.1 Flash'),
  JSON.stringify(modelNames()),
)

// ── folding the selection's provider ────────────────────────────────────────
click(providerToggles()[1])
check(
  'clicking a provider folds exactly that subtree',
  JSON.stringify(expandedProviders()) === JSON.stringify(['DeepSeek 账号']),
  JSON.stringify(expandedProviders()),
)
check(
  'the folded subtree removes its model rows',
  !modelNames().includes('GLM 5.3'),
  JSON.stringify(modelNames()),
)

// ── folding must not scroll the viewport ────────────────────────────────────
//
// The reported bug: toggling a provider snapped the scrollbar back to the top,
// so the user had to scroll down again to see what they had just unfolded. The
// cause was the "keep the active row visible" effect re-running on every fold
// and scrolling to the stale active row — row 0, once the selection's own
// provider was the one folded away.
//
// This block remounts so it starts from a clean pane, then asserts that no
// toggle scrolls. Opening the pane may scroll once (revealing the selection);
// every toggle after that must produce no scroll at all.
{
  state.current = { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' }
  act(() => {
    root.unmount()
  })
  act(() => {
    root = ReactDOM.createRoot(host)
    root.render(React.createElement(registered.component, seatProps))
  })
  openModelPane()
  takeScrollCalls()

  click(providerToggles()[0])
  const afterUnfold = takeScrollCalls()
  check(
    'unfolding a provider does not scroll the viewport',
    afterUnfold.length === 0,
    JSON.stringify(afterUnfold),
  )

  click(providerToggles()[1])
  const afterFold = takeScrollCalls()
  check(
    'folding the selection provider does not scroll the viewport',
    afterFold.length === 0,
    JSON.stringify(afterFold),
  )

  click(providerToggles()[1])
  const afterReUnfold = takeScrollCalls()
  check(
    're-unfolding a provider does not scroll the viewport',
    afterReUnfold.length === 0,
    JSON.stringify(afterReUnfold),
  )
}

// ── selection still works through the tree ──────────────────────────────────
const deepseekModel = modelRows().find(n => n.textContent.includes('DeepSeek V4.1 Flash'))
click(deepseekModel)
check(
  'choosing a model writes the provider/model pair to the directory',
  selections.length === 1 &&
    selections[0].provider === 'deepseek-account' &&
    selections[0].model === 'deepseek-v4.1-flash',
  JSON.stringify(selections),
)

// ── search unfolds matches ──────────────────────────────────────────────────
state.current = { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' }
selections.length = 0
act(() => {
  root.unmount()
})
act(() => {
  root = ReactDOM.createRoot(host)
  root.render(React.createElement(registered.component, seatProps))
})
openModelPane()
const search = document.querySelector('.dml_search')
check('search box is present', search !== null)
takeScrollCalls()
act(() => {
  const input = document.querySelector('input[role="searchbox"]')
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'qwen')
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
check(
  'a search unfolds the provider holding the match',
  expandedProviders().includes('OpenRouter'),
  JSON.stringify(expandedProviders()),
)
check('the match is visible', modelNames().includes('Qwen3 Max'), JSON.stringify(modelNames()))
check(
  'providers without a match are dropped entirely',
  !providerLabels().includes('火山方舟'),
  JSON.stringify(providerLabels()),
)
// The fold fix must not cost the reveal behaviour: a query still scrolls to its
// result, otherwise a match below the fold would stay invisible.
{
  const afterQuery = takeScrollCalls()
  check(
    'typing a query still reveals the matching row',
    afterQuery.some(call => String(call.text).includes('Qwen3 Max')),
    JSON.stringify(afterQuery),
  )
}

// ── the fold layering: search beats browsing, but only for this search ──────
//
// The bug this guards: the search-all-open rule sat BELOW the manual-override
// layer, so a provider the user had folded away earlier stayed folded while a
// search matched inside it — the toggle showed a live count but rendered no
// rows. The fix layers the state as: search default (open) > session collapses
// (this search only) > browsing overrides. These checks drive all three layers:
//
//   1. a pre-search manual fold must NOT hide a search match
//   2. collapsing DURING a search is honoured (otherwise every provider would
//      be a dead toggle while filtering)
//   3. clearing the query restores the browsing state exactly — the session
//      fold never leaks into `expandedOverrides`, and a fresh search starts
//      open again.
{
  const typeQuery = value =>
    act(() => {
      const input = document.querySelector('input[role="searchbox"]')
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  const toggleFor = label =>
    providerToggles().find(n => n.querySelector('.dml_providerName').textContent === label)

  state.current = { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' }
  act(() => {
    root.unmount()
  })
  act(() => {
    root = ReactDOM.createRoot(host)
    root.render(React.createElement(registered.component, seatProps))
  })
  openModelPane()

  // Fold the account provider while BROWSING (open, then close): the explicit
  // close is a permanent browsing override.
  click(toggleFor('DeepSeek 账号'))
  click(toggleFor('DeepSeek 账号'))
  check(
    'browsing: an explicitly folded provider shows no model rows',
    !expandedProviders().includes('DeepSeek 账号') && !modelNames().includes('DeepSeek V4.1'),
    JSON.stringify(expandedProviders()),
  )

  // Search for a model INSIDE that folded provider — the reported bug: it must
  // unfold anyway, because a folded match would read as a broken toggle.
  typeQuery('deepseek')
  check(
    'a search unfolds even a provider the user folded before searching',
    expandedProviders().includes('DeepSeek 账号'),
    JSON.stringify(expandedProviders()),
  )
  check(
    'the hidden match becomes visible',
    modelNames().includes('DeepSeek V4.1 Flash'),
    JSON.stringify(modelNames()),
  )

  // Now a search-session collapse is honoured: the selection provider is open
  // by browsing default, yet folding it mid-search must hide it.
  typeQuery('kimi')
  const volc = toggleFor('火山方舟')
  check('search-session state starts every provider open', volc.getAttribute('aria-expanded') === 'true')
  click(volc)
  check(
    'collapsing during a search is honoured',
    !expandedProviders().includes('火山方舟') && !modelNames().includes('Kimi K2'),
    JSON.stringify(expandedProviders()),
  )

  // Clear the query: the session fold belongs to the search only, so the
  // browsing layer shows through — the selection provider open again (default,
  // no leaked override), the pre-search fold of the account provider intact.
  typeQuery('')
  check(
    'leaving the search restores the browsing fold state exactly',
    JSON.stringify(expandedProviders()) === JSON.stringify(['火山方舟']) &&
      modelNames().includes('GLM 5.3'),
    JSON.stringify(expandedProviders()),
  )

  // A FRESH search starts unfolded again: the previous session's collapse did
  // not persist even within the same menu opening.
  typeQuery('kimi')
  check(
    'a new search re-opens providers collapsed in the previous search',
    expandedProviders().includes('火山方舟') && modelNames().includes('Kimi K2'),
    JSON.stringify(expandedProviders()),
  )
  typeQuery('')
}

// ── the menu box must not flash while typing ────────────────────────────────
//
// The box is `width: max-content` and as tall as its visible rows, and it
// opens UPWARD from the trigger's bottom-right corner — so every keystroke of
// a search moved both the width (longest visible row changes) and the
// position (computed from the measured size). The size lock pins the box for
// the whole search: the same left/top/width/height through every keystroke,
// even though the natural size keeps changing underneath.
{
  const typeQuery = value =>
    act(() => {
      const input = document.querySelector('input[role="searchbox"]')
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })

  state.current = { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' }
  act(() => {
    root.unmount()
  })
  act(() => {
    root = ReactDOM.createRoot(host)
    root.render(React.createElement(registered.component, seatProps))
  })
  openModelPane()

  const opened = readMenuBox()
  check('the open menu carries a locked size', opened !== null && opened.width > 0 && opened.height > 0, JSON.stringify(opened))
  // Sanity: the modelled geometry really would shrink under filtering — the
  // natural size at 'q' (4 visible rows) is smaller than at '' (6 rows), so the
  // lock is doing measurable work, not passing vacuously.
  const naturalWidthOf = () => document.querySelector('.dml_menu').offsetWidth
  const naturalHeightOf = () => document.querySelector('.dml_menu').offsetHeight
  const lockedWidth = naturalWidthOf()
  const lockedHeight = naturalHeightOf()

  typeQuery('q')
  const afterQ = readMenuBox()
  check(
    'typing one character keeps the box geometry identical',
    afterQ !== null &&
      afterQ.left === opened.left &&
      afterQ.top === opened.top &&
      afterQ.width === opened.width &&
      afterQ.height === opened.height,
    JSON.stringify({ opened, afterQ }),
  )

  typeQuery('qw')
  const afterQw = readMenuBox()
  check(
    'typing more keeps the box geometry identical',
    afterQw !== null &&
      afterQw.left === opened.left &&
      afterQw.top === opened.top &&
      afterQw.width === opened.width &&
      afterQw.height === opened.height,
    JSON.stringify({ opened, afterQw }),
  )
  // The lock is meaningful: the natural (unlocked) size really did shrink
  // under the query — otherwise the checks above would pass even without the
  // lock. The DOM still reports the LOCKED size, so compare against what the
  // rows say: fewer model rows are rendered now than at the empty query.
  check(
    'the locked size hides a real shrink (the lock is load-bearing)',
    lockedHeight >= naturalHeightOf() && document.querySelectorAll('.dml_modelRow').length < 4,
    JSON.stringify({ lockedHeight, nowNatural: naturalHeightOf(), rows: document.querySelectorAll('.dml_modelRow').length }),
  )

  // Clearing the query returns to the same epoch geometry — still no flash.
  typeQuery('')
  const afterClear = readMenuBox()
  check(
    'clearing the search keeps the box geometry identical',
    afterClear !== null &&
      afterClear.left === opened.left &&
      afterClear.top === opened.top &&
      afterClear.width === opened.width &&
      afterClear.height === opened.height,
    JSON.stringify({ opened, afterClear }),
  )

  // A pane switch IS a legitimate reshape: the root pane has different content,
  // so the lock must re-measure (not carry the model-pane size into it).
  // Escape is dispatched on the trigger so it bubbles through the seat's root
  // div (React 18 listens at the container; a document-level dispatch would
  // never reach the handler).
  act(() => {
    trigger().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  // Escape from the model pane returns to root (a selection exists).
  const rootBox = readMenuBox()
  check(
    'the root pane re-measures instead of reusing the model pane size',
    rootBox !== null && rootBox.height !== opened.height,
    JSON.stringify({ opened, rootBox }),
  )
}

// ── cold-start label cache ──────────────────────────────────────────────────
//
// The loading state is the shared directory store waiting for the Host's
// model-catalog RPC; the seat cannot shorten that wait, so the last fully
// resolved label is cached per session and shown while `current` is still
// null. A live store drives the loading → ready transition:
//
//   - a seeded cache renders the cached label instead of "正在加载模型…"
//   - the authoritative render replaces it and refreshes the cache
//   - without a cache the loading text shows exactly as before
//   - a selection whose catalog entry is gone (the id fallback) is never cached
{
  // The bundle reads `localStorage` as a page global; expose jsdom's own.
  global.localStorage = dom.window.localStorage
  dom.window.localStorage.clear()

  let snapshot = {
    current: null,
    routable: null,
    groups: [],
    failures: [],
    status: 'loading',
    pending: null,
    error: null,
  }
  const listeners = new Set()
  const liveStore = {
    getSnapshot: () => snapshot,
    subscribe: fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set: next => {
      snapshot = next
      for (const fn of [...listeners]) fn()
    },
  }
  const catalog = () => [
    {
      id: 'deepseek-account',
      name: 'DeepSeek Account',
      models: [
        {
          id: 'deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash',
          reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
        },
      ],
    },
    {
      id: 'volcengine',
      name: '火山方舟',
      models: [
        {
          id: 'glm-5.3',
          name: 'GLM 5.3',
          reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
        },
      ],
    },
  ]
  let cacheRegistered = null
  exportsObj.apply({
    effect: fn => {
      const d = fn()
      return typeof d === 'function' ? d : () => {}
    },
    inject: (services, cb) =>
      cb({
        slots: {
          inject: (slot, register) => register(),
          register: (meta, component) => {
            cacheRegistered = { meta, component }
            return () => {}
          },
        },
        modelDirectories: {
          directoryFor: () => ({ store: liveStore, load: async () => snapshot, select: async () => ({ ok: true }) }),
        },
        sessions: { subagentAddress: () => undefined },
      }),
    get: () => undefined,
    locale: { register: () => () => {}, bind: () => key => key },
  })

  const mountCacheSeat = sessionId => {
    const cacheFace = cacheRegistered.meta.inject(sessionId)
    act(() => {
      root.unmount()
      root = ReactDOM.createRoot(host)
      root.render(
        React.createElement(cacheRegistered.component, {
          locked: false,
          t,
          renderSlot: officialLabel,
          ...cacheFace,
        }),
      )
    })
  }

  // Seed the cache the way a previous session's ready render would have.
  dom.window.localStorage.setItem(
    'dml:lastLabel:session-cold',
    JSON.stringify({
      provider: 'volcengine',
      model: 'glm-5.3',
      providerName: '火山方舟',
      modelName: 'GLM 5.3',
      effortName: 'High',
      at: Date.now(),
    }),
  )
  mountCacheSeat('session-cold')
  // The visual trigger is two spans (label + effort, like the shipped seat);
  // the `·` exists only in the title string, so assert the spans directly.
  check(
    'a cold start shows the cached label instead of the loading text',
    trigger().querySelector('.dml_triggerLabel')?.textContent === '火山方舟/GLM 5.3' &&
      trigger().querySelector('.dml_triggerEffort')?.textContent === 'High' &&
      !trigger().textContent.includes(DICT['trigger.loading']),
    trigger().textContent,
  )
  check(
    'the cached label also reaches the aria label',
    (trigger().getAttribute('aria-label') ?? '').includes('火山方舟/GLM 5.3'),
    trigger().getAttribute('aria-label'),
  )

  // Readiness replaces the cache with the authoritative (slot-routed) label.
  act(() => {
    liveStore.set({
      current: { provider: 'volcengine', model: 'glm-5.3', reasoningEffort: 'high' },
      routable: true,
      groups: catalog(),
      failures: [],
      status: 'ready',
      pending: null,
      error: null,
      retainedEffort: 'High',
    })
  })
  check(
    'the ready store takes over with the authoritative label',
    document.querySelector('.dml_trigger [data-official-label="trigger"]') !== null &&
      trigger().textContent.includes('火山方舟/GLM 5.3'),
    trigger().textContent,
  )

  // A selection made elsewhere updates the cache for the next cold start.
  act(() => {
    liveStore.set({
      current: { provider: 'deepseek-account', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
      routable: true,
      groups: catalog(),
      failures: [],
      status: 'ready',
      pending: null,
      error: null,
      retainedEffort: 'High',
    })
  })
  const refreshed = JSON.parse(dom.window.localStorage.getItem('dml:lastLabel:session-cold'))
  check(
    'a ready render refreshes the session cache',
    refreshed.provider === 'deepseek-account' &&
      refreshed.modelName === 'DeepSeek V4.1 Flash' &&
      refreshed.effortName === 'High',
    JSON.stringify(refreshed),
  )

  // No cache: the cold start reads exactly as before.
  dom.window.localStorage.clear()
  act(() => {
    liveStore.set({
      current: null,
      routable: null,
      groups: [],
      failures: [],
      status: 'loading',
      pending: null,
      error: null,
    })
  })
  mountCacheSeat('session-blank')
  check(
    'without a cache the cold start still shows the loading text',
    trigger().textContent.includes(DICT['trigger.loading']),
    trigger().textContent,
  )

  // A saved selection whose catalog entry is gone renders the id fallback and
  // must never poison the cache with it.
  act(() => {
    liveStore.set({
      current: { provider: 'retired-provider', model: 'retired-model' },
      routable: false,
      groups: catalog(),
      failures: [],
      status: 'ready',
      pending: null,
      error: null,
    })
  })
  check(
    'the id fallback renders for a missing catalog entry',
    trigger().textContent.includes('retired-provider/retired-model'),
    trigger().textContent,
  )
  check(
    'the id fallback is never written into the cache',
    dom.window.localStorage.getItem('dml:lastLabel:session-blank') === null,
    String(dom.window.localStorage.getItem('dml:lastLabel:session-blank')),
  )
}

// ── report ──────────────────────────────────────────────────────────────────
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.ok ? '' : `  [${r.detail}]`}`)
}
console.log(`\n${results.length - failed}/${results.length} render checks passed`)
process.exit(failed === 0 ? 0 : 1)
