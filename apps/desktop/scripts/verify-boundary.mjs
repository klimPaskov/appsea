import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const required = ['src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', 'src-tauri/src/lib.rs']
for (const path of required) await access(resolve(root, path))

const config = JSON.parse(await readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
if (config.identifier !== 'com.appsea.desktop') {
  throw new Error('Unexpected desktop identifier')
}
console.log('desktop Tauri boundary verified')
