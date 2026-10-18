/**
 * Cold-start dependency check for dsh-model-label.
 *
 * The bug this guards: `modelDirectories.directoryFor()` reads
 * `this.ctx.remote.session` inside the Cordis Service proxy, so the CALLER must
 * declare `remote` and `remote.session`. With them missing the call throws
 * `cannot get property "remote.session" without inject`, the Slot entry
 * abdicates, and the composer silently falls back to the shipped seat.
 *
 * This check asserts the bundle's declared inject list against the exact set the
 * shipped ui-model-selection declares, and asserts that the inject face actually
 * calls directoryFor (so the dependency is genuinely load-bearing).
 */
const fs = require('node:fs')
const path = require('node:path')

const CLIENT = path.join(__dirname, 'client.js')
const source = fs.readFileSync(CLIENT, 'utf8')

const problems = []
const ok = []

// ── 1. the declared inject list ──────────────────────────────────────────────
// Anchored on the `slots` entry so a future `const inject = [...]` elsewhere in
// the bundle (a helper, a second plugin row) cannot be picked up instead.
const m = source.match(/const inject = \[\s*['"]slots['"]([^\]]*)\]/)
// Hoisted so section 3 can compare against the same parsed list.
let declared = []
if (m === null) {
  problems.push('could not find the `const inject = [...]` declaration')
} else {
  declared = ['slots', ...m[1].split(',')]
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  ok.push(`declared inject: ${JSON.stringify(declared)}`)

  // The shipped seat declares exactly these for the same reason.
  for (const required of ['slots', 'locale', 'sessions', 'remote', 'remote.session']) {
    if (!declared.includes(required)) {
      problems.push(`inject is missing "${required}" — directoryFor() reads ctx.remote.session and will throw`)
    }
  }
}

// ── 2. the dependency must actually be used ──────────────────────────────────
if (!/\.directoryFor\(/.test(source)) {
  problems.push('no directoryFor() call found — the remote.session dependency may be stale')
} else {
  ok.push('calls modelDirectories.directoryFor() (the call that needs remote.session)')
}

// ── 3. compare against the shipped package's own declaration ─────────────────
// The shipped package only exists once the DSH app bundle has been extracted,
// which is not part of this repository. The comparison is therefore opt-in:
// point DSH_SHIPPED_CLIENT at that package's `lib/client.js` to enable it.
// Without it the check still guards the real invariant (the inject list above)
// and simply reports the skip.
const shipped = process.env.DSH_SHIPPED_CLIENT
if (typeof shipped === 'string' && shipped !== '' && fs.existsSync(shipped)) {
  const shippedSrc = fs.readFileSync(shipped, 'utf8')
  const sm = shippedSrc.match(/const inject = \[([\s\S]*?)\]/)
  if (sm !== null) {
    const shippedList = sm[1]
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
    ok.push(`shipped ui-model-selection inject: ${JSON.stringify(shippedList)}`)
    // Reuse the list parsed in section 1 (it includes the anchor entry), so the
    // two sections can never disagree about what this plugin declares.
    for (const need of ['remote', 'remote.session']) {
      if (shippedList.includes(need) && !declared.includes(need)) {
        problems.push(`shipped declares "${need}" but this plugin does not`)
      }
    }
  }
} else {
  ok.push('(shipped package not extracted; comparison skipped)')
}

// ── 4. the official label child slot stays declared ─────────────────────────
// The registration declares `conversation.input.model.label` with the exact
// spec the shipped seat uses; that declaration is what binds `renderSlot` and
// keeps official label decorations working inside this seat.
if (!/children:\s*\{\s*['"]conversation\.input\.model\.label['"]/.test(source)) {
  problems.push("the registration no longer declares the official 'conversation.input.model.label' child slot")
} else {
  ok.push("declares the official 'conversation.input.model.label' child slot")
}

// ── 5. no Harness Client package is loaded as a module ──────────────────────
// Harness plugin practices: never require('@deepseek-ai/…') from a plugin
// client half — the controls are self-hosted instead.
if (/require\(\s*['"]@deepseek-ai\//.test(source)) {
  problems.push('the bundle loads a Harness Client package as a module (forbidden by the plugin practices)')
} else {
  ok.push('loads no Harness Client package as a module')
}

// ── 6. dsh.client.inject declares the service providers ─────────────────────
// The shipped seat/badge convention: list the packages whose client halves
// provide the services this one consumes, so client halves activate in a
// deterministic order. The runtime `ctx.inject` still waits for the services,
// so a missing entry is convention drift rather than a hard failure — but it
// is exactly the drift the official declaration pattern avoids.
{
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
  const declaredInject = pkg?.dsh?.client?.inject
  const required = [
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-model-selection',
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-locale',
  ]
  if (!Array.isArray(declaredInject)) {
    problems.push('dsh.client.inject is missing from package.json')
  } else {
    const missing = required.filter(dep => !declaredInject.includes(dep))
    if (missing.length > 0) {
      problems.push(`dsh.client.inject is missing: ${missing.join(', ')}`)
    } else {
      ok.push('dsh.client.inject declares the five service providers')
    }
  }
}

// ── 7. no leftover diagnostic scaffolding ────────────────────────────────────
for (const stray of ['dsh-model-label-diagnostic', 'cold-probe', 'model-label-probe', 'sessionStorage.setItem']) {
  if (source.includes(stray)) problems.push(`leftover diagnostic scaffolding: ${stray}`)
}
if (!problems.some(p => p.startsWith('leftover'))) ok.push('no leftover diagnostic scaffolding')

console.log('── OK ──')
for (const line of ok) console.log('  ' + line)
if (problems.length > 0) {
  console.log('\n── PROBLEMS ──')
  for (const p of problems) console.log('  ' + p)
  process.exit(1)
}
console.log('\nCold-start dependency check passed.')
