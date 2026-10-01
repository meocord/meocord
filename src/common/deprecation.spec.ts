import { vi } from 'vitest'
import { ChatInputCommandInteraction, MessageFlags } from 'discord.js'
import { SetMetadata } from '@src/common/decorator.js'
import { forgetDeprecationWarnings, warnDeprecated, warnDeprecatedBehaviour } from '@src/common/deprecation.js'
import { HandlerExecutionContext } from '@src/common/execution-context.js'
import { Logger } from '@src/common/logger.js'
import { createMetadata } from '@src/common/metadata.js'
import { respond } from '@src/common/response/response-state.js'
import { createMockInteraction } from '@src/testing/index.js'

const warnings = () => vi.mocked(Logger.prototype.warn).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  forgetDeprecationWarnings()
})

afterEach(() => {
  vi.restoreAllMocks()
  forgetDeprecationWarnings()
})

describe('warnDeprecated', () => {
  it('says once a run what goes in 5.0 and what to use instead', () => {
    const logger = new Logger('Probe')

    warnDeprecated(logger, 'Old', 'New')
    warnDeprecated(logger, 'Old', 'New')

    expect(warnings()).toEqual(['Old is deprecated and will be removed in the next major version (5.0). Use New instead.'])
  })
})

describe('warnDeprecatedBehaviour', () => {
  it('says once a run what 5.0 does instead and what to use, and forgets it for the next spec', () => {
    const logger = new Logger('Probe')

    warnDeprecatedBehaviour(logger, 'Doing it', 'is refused', 'the other way')
    warnDeprecatedBehaviour(logger, 'Doing it', 'is refused', 'the other way')
    warnDeprecatedBehaviour(logger, 'Retrying it', 'rejects', 'a new one')
    forgetDeprecationWarnings()
    warnDeprecatedBehaviour(logger, 'Doing it', 'is refused', 'the other way')

    expect(warnings()).toEqual([
      'Doing it is deprecated; in the next major version (5.0) it is refused. Use the other way instead.',
      'Retrying it is deprecated; in the next major version (5.0) it rejects. Use a new one instead.',
      'Doing it is deprecated; in the next major version (5.0) it is refused. Use the other way instead.',
    ])
  })
})

describe('deprecated APIs that run', () => {
  const Roles = createMetadata<string[]>('roles')

  class Controller {
    @Roles(['admin'])
    ban() {}
  }

  it('SetMetadata warns once, naming createMetadata', () => {
    SetMetadata('legacy', 1)
    SetMetadata('other', 2)

    expect(warnings()).toEqual([
      'SetMetadata is deprecated and will be removed in the next major version (5.0). Use createMetadata instead.',
    ])
  })

  it('reading by a key warns once, and reading by a createMetadata decorator never does', () => {
    const context = new HandlerExecutionContext({ controller: Controller, methodName: 'ban', args: [] })

    expect(context.get(Roles)).toEqual(['admin'])
    expect(context.getAll(Roles)).toEqual([['admin']])
    expect(warnings()).toEqual([])

    context.get('legacy')
    context.getAll(Symbol('legacy'))

    expect(warnings()).toEqual([
      'Reading metadata by a key with ExecutionContext.get() or getAll() is deprecated and will be removed in the next ' +
        'major version (5.0). Use a decorator made by createMetadata instead.',
    ])
  })

  it("respond()'s ephemeral option warns once, and the flag it stands for never does", async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)

    await respond(interaction).send({ content: 'private', flags: MessageFlags.Ephemeral })
    expect(warnings()).toEqual([])

    await respond(interaction).followUp({ content: 'one', ephemeral: true })
    await respond(interaction).followUp({ content: 'two', ephemeral: true })

    expect(warnings()).toEqual([
      'The ephemeral option of respond() is deprecated and will be removed in the next major version (5.0). Use ' +
        'flags: MessageFlags.Ephemeral instead.',
    ])
  })
})
