import 'reflect-metadata'
import { Attachment, AutocompleteInteraction, ChatInputCommandInteraction, Role, TextChannel } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Autocomplete, Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createChatInputOptions, createMockChannel, createMockInteraction, createMockMember, createMockUser } from '@src/testing/mock-interaction.js'
import { MeoCordTestingModule } from '@src/testing/meocord-testing-module.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// Discord sends an autocomplete's options unresolved: an entity option is its id, and discord.js's getters find nothing.

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const entities = () => ({
  who: createMockUser({ id: '777' }),
  member: createMockMember({ user: createMockUser({ id: '778' }) }),
  role: createMockInteraction(Role, { id: '779' }),
  where: createMockChannel(TextChannel, { id: '780' }),
  // discord.js keeps Attachment's constructor private in its types
  file: Reflect.construct(Attachment, [{ id: '781', filename: 'a.png', url: 'https://cdn/a.png', proxy_url: 'https://cdn/a.png', size: 1 }]) as Attachment,
})

const autocomplete = (values: Record<string, unknown>) => {
  const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'gift' })
  interaction.options = createChatInputOptions({ focused: 'q', q: 'ab', ...values } as never) as never
  return interaction
}

let seen: Record<string, unknown> | undefined
@Controller()
class Gift {
  @Autocomplete('gift')
  suggest(_interaction: AutocompleteInteraction, params: Record<string, unknown>) {
    seen = params
  }

  @Command('gift', CommandType.SLASH)
  give(_interaction: ChatInputCommandInteraction, params: Record<string, unknown>) {
    seen = params
  }
}

const module = () => MeoCordTestingModule.create({ controllers: [Gift] }).compile()

describe('an autocomplete, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it("gives the handler each entity option as its id, as a bot's handler gets it", async () => {
    await module().dispatch(autocomplete(entities()))

    expect(seen).toEqual({ who: '777', member: '778', role: '779', where: '780', file: '781', q: 'ab' })
  })

  it('holds only the id in options.data and options.get(), and its getters find nothing', () => {
    const { options } = autocomplete(entities()) as unknown as { options: Record<string, (...args: unknown[]) => unknown> & { data: object[] } }

    expect(options.data.find(option => (option as { name: string }).name === 'who')).toEqual({ name: 'who', type: 6, value: '777' })
    expect(options.get('who')).toEqual({ name: 'who', type: 6, value: '777' })
    for (const [getter, name] of [['getUser', 'who'], ['getMember', 'member'], ['getRole', 'role'], ['getChannel', 'where'], ['getAttachment', 'file'], ['getMentionable', 'who']]) {
      expect(options[getter](name)).toBeNull()
    }
    expect(() => options.getUser('who', true)).toThrow(expect.objectContaining({ code: 'CommandInteractionOptionEmpty' }))
  })

  it("leaves a command's options resolved", async () => {
    const who = createMockUser({ id: '777' })
    await module().dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'gift', options: createChatInputOptions({ who }) }))

    expect(seen?.who).toBe(who)
  })

  it('warns about nothing', async () => {
    await module().dispatch(autocomplete(entities()))

    expect(warned.filter(line => line.includes('autocomplete option'))).toEqual([])
  })
})

describe('an autocomplete, by default', () => {
  it('keeps the objects given, and warns once for the options, naming each', async () => {
    const values = entities()
    const interaction = autocomplete(values)
    await module().dispatch(interaction)
    await module().dispatch(interaction)

    expect(seen?.who).toBe(values.who)
    expect(warned.filter(line => line.includes('autocomplete option'))).toEqual([
      'The autocomplete options "who", "member", "role", "where", "file" hold resolved objects here, where Discord sends an ' +
        "autocomplete only their ids, so a bot's handler gets the id and getUser() and the like return null. Call " +
        'useStrictMocks(), which reads them as their ids, as Discord sends them. A bare id string reads as a string option.',
    ])
  })

  it('warns once for options given to two autocompletes', () => {
    const options = createChatInputOptions({ focused: 'q', who: createMockUser({ id: '777' }) })
    for (let i = 0; i < 2; i++) createMockInteraction(AutocompleteInteraction, { commandName: 'gift' }).options = options as never

    expect(warned.filter(line => line.includes('autocomplete option'))).toHaveLength(1)
  })

  it('warns when the options are given at creation too, and not for a command or for ids', () => {
    createMockInteraction(AutocompleteInteraction, { commandName: 'gift', options: createChatInputOptions({ focused: 'q', who: createMockUser({ id: '777' }) }) })
    createMockInteraction(ChatInputCommandInteraction, { commandName: 'gift', options: createChatInputOptions({ who: createMockUser({ id: '777' }) }) })
    autocomplete({ who: '777' })

    expect(warned.filter(line => line.includes('autocomplete option'))).toEqual([
      expect.stringMatching(/^The autocomplete option "who" holds a resolved object here/),
    ])
  })
})
