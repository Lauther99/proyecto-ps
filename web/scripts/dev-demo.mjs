// Levanta "next dev" en modo demo (backend simulado). Uso: npm run dev:demo
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const next = createRequire(import.meta.url).resolve('next/dist/bin/next')
const hijo = spawn(process.execPath, [next, 'dev', '-p', '3000'], {
  cwd: dirname(dirname(fileURLToPath(import.meta.url))),
  env: { ...process.env, NEXT_PUBLIC_DEMO: '1' },
  stdio: 'inherit',
})
hijo.on('exit', (codigo) => process.exit(codigo ?? 0))
