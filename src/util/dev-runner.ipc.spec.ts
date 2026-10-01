import { type ChildProcess, fork } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEV_RUNNER_ENV } from '@src/util/dev-runner.util.js'

/**
 * How an application `meocord start --dev` runs hears it ask for a stop, across a real process and its IPC channel, as
 * the dev runner restarts it on every platform. The processes run this repository's sources under Bun.
 */
const bun = process.versions.bun ? process.execPath : 'bun'
const source = JSON.stringify(path.resolve(import.meta.dirname, 'dev-runner.util.ts'))
const scripts = mkdtempSync(path.join(tmpdir(), 'meocord-dev-runner-'))

const script = (name: string, body: string) => {
  const file = path.join(scripts, name)
  writeFileSync(file, body)
  return file
}

// An app that has said how it stops, kept alive by a timer as a bot is by its connection
const stoppingApp = script(
  'stopping.ts',
  `import { onDevRunnerStop } from ${source}
onDevRunnerStop(() => {
  process.send!({ stopped: true })
  setTimeout(() => process.exit(0), 10)
})
setInterval(() => {}, 1_000)
process.send!({ ready: true })
`,
)

// A bundle still loading: its pre-entry listens, and no app has said how it stops yet
const loadingApp = script(
  'loading.ts',
  `import { listenForDevRunnerStop } from ${source}
listenForDevRunnerStop()
setInterval(() => {}, 1_000)
process.send!({ ready: true })
`,
)

// An app with nothing left to do, such as one whose login failed, which must still end on its own
const finishedApp = script(
  'finished.ts',
  `import { onDevRunnerStop } from ${source}
onDevRunnerStop(() => {})
`,
)

const children: ChildProcess[] = []
const start = (file: string) => {
  const child = fork(file, [], { execPath: bun, env: { ...process.env, [DEV_RUNNER_ENV]: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  children.push(child)
  return child
}
const exited = (child: ChildProcess) => new Promise<number | null>(resolve => child.once('exit', code => resolve(code)))
const ready = (child: ChildProcess) =>
  new Promise<void>(resolve => child.on('message', message => (message as { ready?: boolean }).ready && resolve()))

afterAll(() => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  rmSync(scripts, { recursive: true, force: true })
})

describe('a stop from meocord start --dev', () => {
  it('runs the stop the app gave, rather than ending the process outright', async () => {
    const child = start(stoppingApp)
    const messages: unknown[] = []
    child.on('message', message => messages.push(message))
    await ready(child)

    child.send({ meocord: 'stop' })

    expect(await exited(child)).toBe(0)
    expect(messages).toContainEqual({ stopped: true })
  })

  it('ends a process no app has started in yet at once, as SIGTERM would', async () => {
    const child = start(loadingApp)
    await ready(child)

    child.send({ meocord: 'stop' })

    expect(await exited(child)).toBe(0)
  })

  it('leaves a process with nothing left to do free to end on its own', async () => {
    expect(await exited(start(finishedApp))).toBe(0)
  })
})
