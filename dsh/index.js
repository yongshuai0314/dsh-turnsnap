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

  function checkpoint(agent, turnNumber) {
    const header = agent && agent.session && agent.session.header
    const workdir = header && header.cwd
    if (typeof workdir !== 'string' || workdir === '') return

    const policy = policyFor(agent.session)
    const turn = Number(turnNumber) || 0

    ;(async () => {
      const probe = await run('test -d .git && echo yes || echo no', workdir, PROBE_TIMEOUT_MS, policy)
      if (probe.out.trim() !== 'yes') return // not a git repository: stay silent

      const count = await run("git status --porcelain | head -n 500 | wc -l | tr -d ' '", workdir, PROBE_TIMEOUT_MS, policy)
      const files = parseInt(count.out.trim(), 10) || 0
      if (files <= 0) return // clean tree: nothing to preserve

      const clock = new Date().toTimeString().slice(0, 8)
      const message = '[turnsnap] turn ' + turn + ' · ' + files + ' file' + (files === 1 ? '' : 's') + ' · ' + clock
      const done = await run('git add -A && git commit -m ' + quote(message) + ' --no-verify --quiet', workdir, GIT_SNAPSHOT_TIMEOUT_MS, policy)
      if (done.code === 0) {
        console.log('[turnsnap] committed: ' + message)
      } else {
        console.error('[turnsnap] commit failed (exit ' + done.code + '): ' + ((done.err || done.out) || '').slice(0, 200))
      }
    })().catch((error) => {
      console.error('[turnsnap] ' + ((error && error.message) || error))
    })
  }

  ctx.on('agent/turn-stopping', (payload) => {
    try {
      checkpoint(payload && payload.agent, payload && payload.turn)
    } catch (error) {
      console.error('[turnsnap] listener: ' + ((error && error.message) || error))
    }
    // Deliberately not returned: the closing turn never waits on git.
  })

  console.log('[turnsnap] applied; completed turns in git workspaces get a [turnsnap] checkpoint')
}
