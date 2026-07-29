import { rm } from 'node:fs/promises'
import { glob } from 'node:fs/promises'

for await (const path of glob(['**/.next', '**/dist', '**/.turbo'], {
  exclude: ['node_modules/**']
})) {
  await rm(path, { recursive: true, force: true })
}
