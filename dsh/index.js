// TurnSnap — zero-config per-turn git checkpoints for DeepSeek Harness.
//
// After every completed agent turn, if the session's working directory is a
// git repository with uncommitted changes, stage everything and create one
// tagged `[turnsnap]` commit. Rollback points accumulate without the model or
// the user doing anything; `turnsnap_pause` / `turnsnap_resume` /
// `turnsnap_status` give both of them a switch.
//
// Host-only by design: no browser half, no settings card, nothing that needs
// a page refresh. One install, one HMR reload, and it is live.
//
// Loaded via the cordis.patch.yml row declared by package.json `dsh.bundle`.

export const name = 'turnsnap'

// The checkpoint engine runs git through the harness shell service rather
// than spawning processes directly, so executions stay inside whatever file
// sandbox governs the owning session.
export const inject = ['shell']

const GIT_SNAPSHOT_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 10_000

// Counters surfaced through turnsnap_status so users can verify the plugin
// is alive without digging through stderr.
const stats = { commits: 0, skippedTurns: 0, errors: 0, lastCheckpoint: null }
const paused = { value: false }

function quote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

export function apply(ctx) {
  const shell = ctx.shell ?? ctx.get('shell')
  if (!shell) {
    console.error('[turnsnap] shell service unavailable; the plugin stays inert')
    return
  }

  // Best-effort access to the host's sandbox-policy resolver. When present,
  // every shell request is stamped with the owning session's standing file
  // policy, so a workspace-write session confines its own checkpoints and a
  // danger-full-access session simply works. Absent, the executor applies its
  // own default.
  function policyFor(session) {
    try {
      const resolver = ctx.get('sandboxPolicy')
      return resolver && session ? resolver.resolve({ session }) : undefined
    } catch {
      return undefined
    }
  }

  function run(command, workdir, timeoutMs, sandboxPolicy) {
    const spec = shell.resolve({
      command,
      workdir,
      timeoutMs,
      stdoutMaxBytes: 65_536,
      ...(sandboxPolicy !== undefined ? { sandboxPolicy } : {}),
    })
    return shell.run(spec).then((result) => ({
      code: result.exitCode,
      out: (result.stdout && result.stdout.text) || '',
      err: (result.stderr && result.stderr.text) || '',
    }))
  }

  // One git index per worktree means concurrent checkpoints (parent session
  // and subagents closing turns at the same time) must not race. Every
  // snapshot is appended to a single promise chain; a failure is contained
  // and can never poison later snapshots.
  let queue = Promise.resolve()

  function checkpoint(agent, turnNumber) {
    const header = agent && agent.session && agent.session.header
    const workdir = header && header.cwd
    if (typeof workdir !== 'string' || workdir === '') return

    const policy = policyFor(agent.session)
    const turn = Number(turnNumber) || 0

    queue = queue.then(async () => {
      if (paused.value) return
      const probe = await run('test -d .git && echo yes || echo no', workdir, PROBE_TIMEOUT_MS, policy)
      if (probe.out.trim() !== 'yes') {
        stats.skippedTurns++
        return // not a git repository: stay silent
      }

      const count = await run("git status --porcelain | head -n 500 | wc -l | tr -d ' '", workdir, PROBE_TIMEOUT_MS, policy)
      const files = parseInt(count.out.trim(), 10) || 0
      if (files <= 0) {
        stats.skippedTurns++
        return // clean tree: nothing to preserve
      }

      const clock = new Date().toTimeString().slice(0, 8)
      const message = '[turnsnap] turn ' + turn + ' · ' + files + ' file' + (files === 1 ? '' : 's') + ' · ' + clock
      const done = await run('git add -A && git commit -m ' + quote(message) + ' --no-verify --quiet', workdir, GIT_SNAPSHOT_TIMEOUT_MS, policy)
      if (done.code === 0) {
        stats.commits++
        stats.lastCheckpoint = { workdir, message, files, at: Date.now() }
        console.log('[turnsnap] committed: ' + message)
      } else {
        stats.errors++
        console.error('[turnsnap] commit failed (exit ' + done.code + '): ' + ((done.err || done.out) || '').slice(0, 200))
      }
    })().catch((error) => {
      console.error('[turnsnap] ' + ((error && error.message) || error))
    })
    // Contain the failure so the shared chain keeps working for later turns.
    queue = queue.catch(() => {})
  }

  ctx.on('agent/turn-stopping', (payload) => {
    try {
      checkpoint(payload && payload.agent, payload && payload.turn)
    } catch (error) {
      console.error('[turnsnap] listener: ' + ((error && error.message) || error))
    }
    // Deliberately not returned: the closing turn never waits on git.
  })

  function statusPayload() {
    return { enabled: !paused.value, ...stats }
  }

  const renderJson = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

  function registerControlTool(tool) {
    try {
      ctx.tools.register(tool)
    } catch (error) {
      // Duplicate name or a preview-era surface change: degrade loudly
      // instead of taking the whole plugin down.
      console.error('[turnsnap] ' + tool.name + ' registration skipped: ' + error)
    }
  }

  registerControlTool({
    name: 'turnsnap_pause',
    description:
      'Pause TurnSnap so completed turns no longer produce automatic git checkpoint commits, until turnsnap_resume is called.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute() {
      paused.value = true
      return { ok: true, ...statusPayload() }
    },
  })

  registerControlTool({
    name: 'turnsnap_resume',
    description: 'Resume TurnSnap automatic per-turn git checkpoint commits.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute() {
      paused.value = false
      return { ok: true, ...statusPayload() }
    },
  })

  registerControlTool({
    name: 'turnsnap_status',
    description:
      'Show the TurnSnap state: whether per-turn auto-commits are enabled, counters (commits, skipped turns, errors), and the last checkpoint message.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute() {
      return statusPayload()
    },
  })

  console.log('[turnsnap] applied; completed turns in git workspaces get a [turnsnap] checkpoint')
}
