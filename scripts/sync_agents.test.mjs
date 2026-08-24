import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import test from 'node:test'
import assert from 'node:assert/strict'

const execFileAsync = promisify(execFile)

test('catalog sync preserves an intentionally empty root AGENTS.md', async () => {
  const root = process.cwd()
  const before = await readFile(`${root}/AGENTS.md`, 'utf8')
  const packageManager = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const packageArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm agents:sync'] : ['agents:sync']
  const { stdout } = await execFileAsync(packageManager, packageArgs, { cwd: root })
  const after = await readFile(`${root}/AGENTS.md`, 'utf8')

  assert.match(stdout, /synced \d+ skills and \d+ subagents/)
  if (before.trim() === '') {
    assert.equal(after, before)
    assert.match(stdout, /preserved empty user-owned AGENTS\.md/)
  } else {
    assert.match(after, /<!-- BEGIN GENERATED SKILL CATALOG -->/)
    assert.match(after, /<!-- BEGIN GENERATED SUBAGENT CATALOG -->/)
  }
})
