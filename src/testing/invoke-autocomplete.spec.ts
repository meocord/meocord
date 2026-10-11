import { AutocompleteInteraction } from 'discord.js'
import { Autocomplete, Controller } from '@src/decorator/index.js'
import { Logger } from '@src/common/logger.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import { createChatInputOptions, createMockInteraction, MeoCordTestingModule } from './index.js'

const ran: string[] = []

@Controller()
class Search {
  @Autocomplete('search', 'query')
  async query(interaction: AutocompleteInteraction) {
    ran.push('query')
    await interaction.respond([])
  }

  @Autocomplete('search')
  async rest(interaction: AutocompleteInteraction) {
    ran.push('rest')
    await interaction.respond([])
  }
}

@Controller()
class Tags {
  @Autocomplete('tags add', 'name')
  async add(interaction: AutocompleteInteraction) {
    ran.push('add')
    await interaction.respond([])
  }
}

/** An autocomplete for `commandName`, typing `focused`, under `subcommand` when given. */
const autocomplete = (commandName: string, focused?: string, subcommand?: string) =>
  createMockInteraction(AutocompleteInteraction, {
    commandName,
    options: createChatInputOptions({ ...(subcommand && { subcommand }), ...(focused && { focused, [focused]: 'ab' }) }),
  })

const MISSPELLED = `autocomplete for "serach" option "query" does not match Search.query's route 'search' option 'query'.`
const OTHER_OPTION = `autocomplete for "search" option "tag" does not reach Search.query: dispatch runs Search.rest.`
const NOT_FOCUSED =
  `autocomplete for "search" does not reach Search.query: dispatch runs Search.rest. ` +
  `Give the mock the focused option: options: createChatInputOptions({ focused: 'query' }).`

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  ran.length = 0
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const compile = () => MeoCordTestingModule.create({ controllers: [Search, Tags] }).compile()

describe('invoke given an autocomplete dispatch gives to another handler or to none, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it.each([
    ['a misspelled command', 'query', autocomplete('serach', 'query'), MISSPELLED],
    ["a focused option the command's whole-command handler takes", 'query', autocomplete('search', 'tag'), OTHER_OPTION],
    ['no focused option', 'query', autocomplete('search'), NOT_FOCUSED],
    [
      "an option another handler takes, given to the whole-command handler",
      'rest',
      autocomplete('search', 'query'),
      `autocomplete for "search" option "query" does not reach Search.rest: dispatch runs Search.query.`,
    ],
  ] as const)('rejects %s before the handler runs, naming what dispatch does', async (_, method, interaction, message) => {
    await expect(compile().invoke(Search, method, interaction)).rejects.toThrow(message)
    expect(ran).toEqual([])
  })

  it("takes the autocomplete dispatch gives the handler, by its path, its command's name, and its option", async () => {
    const module = compile()

    await module.invoke(Search, 'query', autocomplete('search', 'query'))
    await module.invoke(Search, 'rest', autocomplete('search', 'tag'))
    // A subcommand's path with no handler of its own falls back to the command's name, as in dispatch
    await module.invoke(Search, 'rest', autocomplete('search', 'tag', 'deep'))
    await module.invoke(Tags, 'add', autocomplete('tags', 'name', 'add'))

    expect(ran).toEqual(['query', 'rest', 'rest', 'add'])
    expect(warned).toEqual([])
  })

  it('leaves a mock built without a command name unchecked', async () => {
    await compile().invoke(Search, 'query', createMockInteraction(AutocompleteInteraction))

    expect(ran).toEqual(['query'])
  })
})

describe('invoke given an autocomplete dispatch gives to another handler or to none, without strict mocks', () => {
  it('warns once for each handler and route, saying strict mocks reject it, and runs the handler', async () => {
    const module = compile()

    await module.invoke(Search, 'query', autocomplete('serach', 'query'))
    await module.invoke(Search, 'query', autocomplete('serach', 'query'))
    await module.invoke(Search, 'query', autocomplete('search', 'tag'))

    expect(ran).toEqual(['query', 'query', 'query'])
    expect(warned).toEqual([`${MISSPELLED} Under useStrictMocks(), invoke rejects it.`, `${OTHER_OPTION} Under useStrictMocks(), invoke rejects it.`])
  })
})

describe('invoke and dispatch on an autocomplete', () => {
  /** A small seeded generator (mulberry32), so a failure reproduces from its seed. */
  function random(seed: number) {
    let state = seed >>> 0
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    return { next, pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] }
  }

  const PATHS = ['a', 'a x', 'a y', 'b']
  const OPTIONS = [undefined, 'p', 'q'] as const

  it('agree on the handler: invoke takes exactly the one dispatch runs, and refuses the rest', async () => {
    useStrictMocks()
    for (let seed = 1; seed <= 40; seed++) {
      const r = random(seed)
      const controllers = [0, 1].map(c => {
        @Controller()
        class Generated {}
        Object.defineProperty(Generated, 'name', { value: `C${c}` })
        for (let i = 0; i < 1 + Math.floor(r.next() * 3); i++) {
          const method = `h${i}`
          ;(Generated.prototype as Record<string, unknown>)[method] = async (interaction: AutocompleteInteraction) => interaction.respond([])
          Autocomplete(r.pick(PATHS), r.pick(OPTIONS))(Generated.prototype, method, Object.getOwnPropertyDescriptor(Generated.prototype, method) as never)
        }
        return Generated
      })
      const module = MeoCordTestingModule.create({ controllers }).compile()
      const [command, sub] = r.pick(PATHS).split(' ')
      const focused = r.pick(['p', 'q', undefined] as const)
      // A fresh interaction for each call, since an autocomplete answers once
      const input = () => autocomplete(command, focused, sub)
      const { handlers } = await module.dispatch(input())
      const reached = handlers.map(({ controller, method }) => `${controller.name}.${method}`)

      for (const controller of controllers) {
        for (const method of Object.getOwnPropertyNames(controller.prototype).filter(name => name !== 'constructor')) {
          const name = `${controller.name}.${method}`
          const accepted = await module.invoke(controller, method as never, input() as never).then(
            () => true,
            () => false,
          )
          expect({ seed, name, accepted }).toEqual({ seed, name, accepted: reached.includes(name) })
        }
      }
    }
  })
})
