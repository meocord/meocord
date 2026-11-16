import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as discord from 'discord.js'
import { createMockInteraction } from 'meocord/testing'

/** A key no discord.js class has, which a strict mock reads as undefined unless its class's fields can't be read. */
const NOT_A_FIELD = 'notAFieldOfAnyClass'

/**
 * Under strict mocks, each checked class's declared properties its mock does not hold `in`, and the classes whose mock
 * keeps placeholders since its fields could not be read. verify-runners.ts writes the declared properties, read from
 * the installed discord.js typings, to declared-fields.json.
 */
export function strictFieldGaps(): { missing: string[]; unread: string[] } {
  const declared = JSON.parse(readFileSync(path.join(process.cwd(), 'declared-fields.json'), 'utf8')) as Record<string, string[]>
  const missing: string[] = []
  const unread: string[] = []
  for (const [name, keys] of Object.entries(declared)) {
    const mock = createMockInteraction((discord as unknown as Record<string, never>)[name]!) as unknown as Record<string, unknown>
    if (mock[NOT_A_FIELD] !== undefined) unread.push(name)
    else for (const key of keys) if (!(key in mock)) missing.push(`${name}.${key}`)
  }
  return { missing, unread }
}
