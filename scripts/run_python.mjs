import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requestedArguments = process.argv.slice(2)

if (requestedArguments.length === 0) {
  console.error('Usage: node scripts/run_python.mjs <script> [...arguments]')
  process.exit(2)
}

const candidates =
  process.platform === 'win32'
    ? [
        { command: 'py', prefix: ['-3.13'] },
        { command: 'py', prefix: ['-3.12'] },
        { command: 'py', prefix: ['-3.11'] },
        { command: 'python', prefix: [] }
      ]
    : [
        { command: 'python3', prefix: [] },
        { command: 'python', prefix: [] }
      ]

function spawnProcess(command, args, stdio) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio
    })
    let output = ''
    if (stdio === 'pipe') {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        output += chunk
      })
      child.stderr.on('data', (chunk) => {
        output += chunk
      })
    }
    child.on('error', () => resolve({ code: null, output: '' }))
    child.on('close', (code) => resolve({ code, output }))
  })
}

async function selectPython() {
  for (const candidate of candidates) {
    const probe = await spawnProcess(candidate.command, [...candidate.prefix, '--version'], 'pipe')
    const match = probe.output.match(/Python\s+(\d+)\.(\d+)/)
    if (probe.code === 0 && match && Number(match[1]) === 3 && Number(match[2]) >= 11) {
      return candidate
    }
  }
  return undefined
}

const python = await selectPython()
if (!python) {
  console.error('AppSea repository scripts require Python 3.11 or later.')
  process.exit(1)
}

const result = await spawnProcess(
  python.command,
  [...python.prefix, ...requestedArguments],
  'inherit'
)
process.exit(result.code ?? 1)
