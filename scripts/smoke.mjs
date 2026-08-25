#!/usr/bin/env node
// Smoke test: exercises the exact git command sequence TurnSnap runs on each
// turn — dirty-tree detection, the tagged commit, and the skip rules —
// against a throwaway repository. Dependency-free on purpose so `node
// scripts/smoke.mjs` works straight after a source install.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
function check(label, ok) {
  console.log((ok ? 'ok   ' : 'FAIL ') + label)
  if (!ok) failures++
}

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'"

const repo = mkdtempSync(join(tmpdir(), 'turnsnap-smoke-'))
try {
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.email', 'smoke@example.invalid')
  git(repo, 'config', 'user.name', 'TurnSnap Smoke')

  // Clean tree must report zero pending files.
  const cleanCount = parseInt(execFileSync('bash', ['-c', "git status --porcelain | head -n 500 | wc -l | tr -d ' '"], { cwd: repo, encoding: 'utf8' }).trim(), 10)
  check('clean tree counts zero files', cleanCount === 0)

  // Dirty tree must count the change.
  writeFileSync(join(repo, 'notes.txt'), 'draft\n')
  const dirtyCount = parseInt(execFileSync('bash', ['-c', "git status --porcelain | head -n 500 | wc -l | tr -d ' '"], { cwd: repo, encoding: 'utf8' }).trim(), 10)
  check('dirty tree counts one file', dirtyCount === 1)

  // The exact commit command the engine runs.
  const message = '[turnsnap] turn 1 · 1 file · 00:00:00'
  execFileSync('bash', ['-c', 'git add -A && git commit -m ' + quote(message) + ' --no-verify --quiet'], { cwd: repo })
  const log = git(repo, 'log', '--format=%s', '-n', '1')
  check('checkpoint commit lands with the tagged subject', log.trim() === message)

  // .gitignore stays respected by add -A.
  writeFileSync(join(repo, '.gitignore'), 'ignored.log\n')
  writeFileSync(join(repo, 'ignored.log'), 'noise\n')
  execFileSync('bash', ['-c', 'git add -A && git commit -m ' + quote('[turnsnap] turn 2 · 1 file · 00:00:01') + ' --no-verify --quiet'], { cwd: repo })
  const tracked = git(repo, 'ls-files')
  check('ignored file never gets tracked', !tracked.includes('ignored.log') && tracked.includes('.gitignore'))
} finally {
  rmSync(repo, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(failures + ' check(s) failed')
  process.exit(1)
}
console.log('all checks passed')
