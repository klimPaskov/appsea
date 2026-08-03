import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const required = [
  'src-tauri/Cargo.toml',
  'src-tauri/build.rs',
  'src-tauri/tauri.conf.json',
  'src-tauri/src/lib.rs',
  'src-tauri/capabilities/default.json'
]
for (const path of required) await access(resolve(root, path))

const config = JSON.parse(await readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
if (config.identifier !== 'com.appsea.desktop') {
  throw new Error('Unexpected desktop identifier')
}
if (config.bundle?.active !== false) {
  throw new Error('Desktop bundling must stay disabled until signed release evidence exists')
}
if (
  typeof config.app?.security?.csp !== 'string' ||
  !config.app.security.csp.includes("object-src 'none'")
) {
  throw new Error('Desktop CSP must deny plugin content')
}

const capability = JSON.parse(
  await readFile(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8')
)
if (
  capability.identifier !== 'main-capability' ||
  !capability.permissions?.includes('core:default')
) {
  throw new Error('Unexpected desktop capability boundary')
}
console.log('desktop Tauri boundary verified')
