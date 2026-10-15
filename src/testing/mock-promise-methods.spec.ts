import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'
import * as discord from 'discord.js'
import { Collection, TextChannel } from 'discord.js'
import { returnsPromise } from './mock-interaction.js'
import { createMockChannel, createMockGuild, createMockMember, createMockMessage } from './index.js'
import { WARM_UP_TIMEOUT_MS } from '@src/spec-timeouts.js'

type Method = (...args: unknown[]) => unknown
interface TypedMethod {
  name: string
  target: object
  key: string
  method: Method
  promise: boolean
}

// The classes the mocks are made of: structures and managers
const modelled = (Class: { prototype: object }) =>
  discord.Base.prototype.isPrototypeOf(Class.prototype) || discord.BaseManager.prototype.isPrototypeOf(Class.prototype)

// A method's own function, found on the prototype chain without running a getter
function methodOf(prototype: object, key: string): Method | undefined {
  for (let proto: object | null = prototype; proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key)
    if (descriptor) return typeof descriptor.value === 'function' ? (descriptor.value as Method) : undefined
  }
  return undefined
}

/** Each non-async method of a modelled class, and whether discord.js's typings say it returns a promise. */
function typedMethods(): TypedMethod[] {
  const typings = path.join(path.dirname(createRequire(import.meta.url).resolve('discord.js')), '../typings/index.d.ts')
  const program = ts.createProgram([typings], { strict: true, skipLibCheck: true, noEmit: true, target: ts.ScriptTarget.ES2022 })
  const checker = program.getTypeChecker()
  const module = checker.getSymbolAtLocation(program.getSourceFile(typings)!)!
  const found: TypedMethod[] = []
  for (const exported of checker.getExportsOfModule(module)) {
    const Class = (discord as unknown as Record<string, { prototype?: object }>)[exported.name]
    if (!(exported.flags & ts.SymbolFlags.Class) || !Class?.prototype || !modelled(Class as { prototype: object })) continue
    for (const property of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(exported))) {
      const method = methodOf(Class.prototype, property.name)
      const declaration = property.valueDeclaration ?? property.declarations?.[0]
      if (!method || property.name === 'constructor' || method.constructor.name === 'AsyncFunction' || !declaration) continue
      const signatures = checker.getTypeOfSymbolAtLocation(property, declaration).getCallSignatures()
      if (signatures.length === 0) continue
      const promise = signatures.some(signature => checker.getReturnTypeOfSignature(signature).getSymbol()?.name === 'Promise')
      found.push({ name: `${exported.name}.${property.name}`, target: Object.create(Class.prototype) as object, key: property.name, method, promise })
    }
  }
  return found
}

describe('a mock of a discord.js method that returns a promise without being async', () => {
  // Reading discord.js's typings builds a TypeScript program, which is the file's setup rather than the test's
  let methods: TypedMethod[]
  beforeAll(() => {
    methods = typedMethods()
  }, WARM_UP_TIMEOUT_MS)

  // A discord.js upgrade that adds such a method, or one that turns a listed name synchronous elsewhere, fails here
  it('resolves exactly where discord.js typings say the method returns a promise', () => {
    expect(methods.length).toBeGreaterThan(100)

    const disagree = methods.filter(({ target, key, method, promise }) => returnsPromise(target, key, method) !== promise)
    expect(disagree.map(({ name, promise }) => `${name} ${promise ? 'returns a promise' : 'is synchronous'}`)).toEqual([])
  })

  it('resolves, so .catch() and .then() work, to what discord.js resolves to', async () => {
    const guild = createMockGuild()
    const member = createMockMember({ guild })
    const channel = createMockChannel(TextChannel, { guild } as never)

    await expect(member.kick('spam').catch(() => null)).resolves.toBe(member)
    await expect(channel.awaitMessages({ max: 1 }).then(collected => collected)).resolves.toEqual(new Collection())
    await expect(createMockMessage({ guild }).awaitReactions({ max: 1 })).resolves.toEqual(new Collection())
    await expect(guild.members.unban('200000000000000001').catch(() => null)).resolves.toBeUndefined()
    await expect(channel.createWebhook({ name: 'Logs' }).then(() => 'made')).resolves.toBe('made')
  })
})
