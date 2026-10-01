import { type ChildProcess, fork } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryCooldownStore } from '@src/common/index.js'
import { answerCooldown, type CooldownChannel, shardedCooldownStoreOn } from '@src/common/sharded-cooldown-store.js'
import { type ShardMessage } from '@src/core/shard-messages.js'
import { testCooldownStore } from '@src/testing/index.js'

/**
 * ShardedCooldownStore across real processes and their IPC, as discord.js's process sharding connects a
 * shard to its manager. The processes run this repository's sources under Bun, which reads TypeScript.
 */
const bun = process.versions.bun ? process.execPath : 'bun'
const source = (file: string) => JSON.stringify(path.resolve(import.meta.dirname, file))
const scripts = mkdtempSync(path.join(tmpdir(), 'meocord-sharded-'))

const script = (name: string, body: string) => {
  const file = path.join(scripts, name)
  writeFileSync(file, body)
  return file
}

const managerScript = script(
  'manager.ts',
  `import { MemoryCooldownStore } from ${source('cooldown-store.ts')}
import { answerCooldown } from ${source('sharded-cooldown-store.ts')}
const store = new MemoryCooldownStore()
process.on('message', message => answerCooldown(store, message, reply => process.send!(reply)))
process.send!({ ready: true })
`,
)

// A shard at the limit: five calls at once where three may pass.
const shardScript = script(
  'shard.ts',
  `import { ShardedCooldownStore } from ${source('sharded-cooldown-store.ts')}
const store = new ShardedCooldownStore()
const verdicts = await Promise.all(Array.from({ length: 5 }, () => store.consume('shared', { uses: 3, windowMs: 10_000 })))
process.send!({ allowed: verdicts.filter(verdict => verdict.allowed).length })
`,
)

const children: ChildProcess[] = []
const start = (file: string, env: NodeJS.ProcessEnv = {}) => {
  const child = fork(file, [], { execPath: bun, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  children.push(child)
  return child
}

afterAll(() => {
  for (const child of children) if (child.connected) child.kill()
  rmSync(scripts, { recursive: true, force: true })
})

describe('ShardedCooldownStore with a manager in another process', () => {
  const manager = start(managerScript)
  const ready = new Promise<void>(resolve => manager.once('message', () => resolve()))
  const channel: CooldownChannel = {
    send: message => void manager.send(message),
    onMessage: listener => void manager.on('message', listener),
    onClose: listener => void manager.on('disconnect', listener),
  }

  beforeAll(() => ready, 20_000)

  testCooldownStore('ShardedCooldownStore over IPC', () => shardedCooldownStoreOn(channel), { describe, it, expect })
})

describe('ShardedCooldownStore in two shard processes', () => {
  it('is exact across shards: of ten calls at once from two shards, three pass where three may', async () => {
    const store = new MemoryCooldownStore()
    const shards = [start(shardScript, { SHARDING_MANAGER: 'true' }), start(shardScript, { SHARDING_MANAGER: 'true' })]
    const allowed = await Promise.all(
      shards.map(
        shard =>
          new Promise<number>(resolve => {
            shard.on('message', (message: unknown) => {
              if (answerCooldown(store, message, (reply: ShardMessage) => shard.send(reply))) return
              resolve((message as { allowed: number }).allowed)
            })
          }),
      ),
    )

    expect(allowed[0] + allowed[1]).toBe(3)
  }, 20_000)
})
