import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as testing from './index.js'

// Factories of values no discord.js or testing-module slot takes, so the composition matrix has nothing to pass them to
const NOT_DISCORD_VALUES = new Set(['createMockFn', 'createMockTheme', 'createExecutionContext', 'createDiscordError'])

describe('the composition matrix', () => {
  it('passes every mock factory where its value fits, so a factory whose type fits no slot is caught', () => {
    const matrix = readFileSync(path.join(import.meta.dirname, 'composition.test-d.ts'), 'utf8')
    const factories = Object.keys(testing).filter(name => name.startsWith('create') && !NOT_DISCORD_VALUES.has(name))

    expect(factories.length).toBeGreaterThan(0)
    expect(factories.filter(name => !new RegExp(`\\b${name}[<(]`).test(matrix))).toEqual([])
  })
})
