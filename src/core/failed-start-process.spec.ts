import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CHILD_PROCESS_CASE_TIMEOUT_MS, CHILD_PROCESS_TIMEOUT_MS } from '@src/spec-timeouts.js'

/**
 * A bot whose provider's factory fails, in a real process: what the start made before it, such as a pool whose open
 * connection keeps the event loop alive, is closed, so the process ends with the code the failure set. The process
 * runs this repository's sources under Bun.
 */
const bun = process.versions.bun ? process.execPath : 'bun'
const source = (file: string) => JSON.stringify(path.resolve(import.meta.dirname, '..', file))
const bot = mkdtempSync(path.join(tmpdir(), 'meocord-failed-start-'))

afterAll(() => rmSync(bot, { recursive: true, force: true }))

it('ends with exit code 1 once it closes the pool a failed factory left open, under the generated main.ts', async () => {
  mkdirSync(path.join(bot, 'dist'))
  writeFileSync(path.join(bot, 'dist', 'meocord.config.mjs'), "export default { discordToken: 'not-a-real-token' }\n")
  writeFileSync(
    path.join(bot, 'main.ts'),
    `import { MeoCord } from ${source('decorator/index.ts')}
import { MeoCordFactory } from ${source('core/meocord-factory.ts')}
import { isExplainedError } from ${source('common/index.ts')}

class App {}
MeoCord({
  controllers: [],
  providers: [
    {
      provide: 'POOL',
      // An open connection: the event loop stays alive until the pool closes
      useFactory: async () => {
        const connection = setInterval(() => {}, 1_000)
        return { onShutdown: () => { clearInterval(connection); console.log('pool closed') } }
      },
    },
    { provide: 'CACHE', inject: ['POOL'], useFactory: async () => { throw new Error('cache unreachable') } },
  ],
  clientOptions: { intents: [] },
})(App)

// As the generated main.ts does
MeoCordFactory.create(App).start().catch(error => {
  if (isExplainedError(error)) return
  console.error('Error during startup:', error)
  process.exitCode = 1
})
`,
  )

  const child = spawn(bun, ['main.ts'], { cwd: bot, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => (output += chunk))
  child.stderr.on('data', chunk => (output += chunk))
  // A bot that stays alive is killed at the bound, and its exit code shows it
  const killed = setTimeout(() => child.kill('SIGKILL'), CHILD_PROCESS_TIMEOUT_MS)
  const code = await new Promise<number | null>(resolve => child.once('exit', resolve))
  clearTimeout(killed)

  expect({ code, closed: output.includes('pool closed') }).toEqual({ code: 1, closed: true })
}, CHILD_PROCESS_CASE_TIMEOUT_MS)
