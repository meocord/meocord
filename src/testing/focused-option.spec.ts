import { ApplicationCommandOptionType, DiscordjsErrorCodes } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createChatInputOptions } from '@src/testing/mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

/** The focused option's value as getFocused(), getFocused(true) and options.data each give it. */
const readings = (options: ReturnType<typeof createChatInputOptions>) => [
  options.getFocused(),
  options.getFocused(true).value,
  options.data.find(option => option.focused)?.value,
]

describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])("an autocomplete's focused option, in %s mode", (_mode, setUp) => {
  beforeEach(() => setUp())

  it('reads as an empty string before anything is typed, as Discord sends it', () => {
    const options = createChatInputOptions({ focused: 'query' })

    expect(readings(options)).toEqual(['', '', ''])
    expect(options.data).toEqual([expect.objectContaining({ name: 'query', type: ApplicationCommandOptionType.String, focused: true })])
  })

  it('reads a string as given, marked focused in options.data alone', () => {
    const options = createChatInputOptions({ focused: 'query', query: 'ad', scope: 'all' })

    expect(readings(options)).toEqual(['ad', 'ad', 'ad'])
    expect(options.data.map(option => [option.name, option.focused])).toEqual([
      ['query', true],
      ['scope', undefined],
    ])
    expect(options.getFocused(true)).toEqual(options.data[0])
  })

  it('finds the focused option under a subcommand', () => {
    const options = createChatInputOptions({ subcommandGroup: 'notify', subcommand: 'email', focused: 'address' })

    expect(readings(options)).toEqual(['', '', undefined])
    expect(options.data[0].options?.[0].options).toEqual([expect.objectContaining({ name: 'address', value: '', focused: true })])
  })
})

describe('a number given for the focused option', () => {
  it('reads as its digits under useStrictMocks(), keeping its type', () => {
    useStrictMocks()
    const options = createChatInputOptions({ focused: 'amount', amount: 5 })

    expect(readings(options)).toEqual(['5', '5', '5'])
    expect(options.getFocused(true).type).toBe(ApplicationCommandOptionType.Integer)
    expect(warned).toEqual([])
  })

  it('reads as the number in default mode, with one warning that Discord sends a string', () => {
    const options = createChatInputOptions({ focused: 'amount', amount: 5 })

    expect(readings(options)).toEqual([5, 5, 5])
    expect(warned).toEqual([expect.stringMatching(/focused option "amount".*number.*string.*5\.0.*'5'.*useStrictMocks\(\)/s)])
  })
})

describe("an autocomplete's focused option read by name", () => {
  it('reads as Discord sent it under useStrictMocks(): an empty string, the option marked focused', () => {
    useStrictMocks()
    const options = createChatInputOptions({ focused: 'query' })

    expect([options.getString('query'), options.getString('query', true), options.getInteger('query')]).toEqual(['', '', ''])
    expect(options.get('query')).toBe(options.data[0])
    expect(options.get('query')).toEqual({ name: 'query', type: ApplicationCommandOptionType.String, value: '', focused: true })
    expect(warned).toEqual([])
  })

  it('reads a typed number as its digits under useStrictMocks(), its type kept', () => {
    useStrictMocks()
    const options = createChatInputOptions({ focused: 'n', n: 12 })

    expect([options.getInteger('n'), options.get('n')?.focused]).toEqual(['12', true])
    expect(() => options.getString('n')).toThrow(expect.objectContaining({ code: DiscordjsErrorCodes.CommandInteractionOptionType }))
  })

  it('reads as before in default mode, with one warning that discord.js reads the option Discord sent', () => {
    const options = createChatInputOptions({ focused: 'query' })

    expect(options.getString('query')).toBeNull()
    expect(warned).toEqual([expect.stringMatching(/^The focused option "query" is read here from what the test gave, where discord\.js reads the option Discord sent.*useStrictMocks\(\)/s)])
    expect(options.get('query')).toBeNull()
    expect(() => options.getString('query', true)).toThrow(expect.objectContaining({ code: DiscordjsErrorCodes.CommandInteractionOptionNotFound }))
    expect(warned).toHaveLength(1)
  })

  it('reads a typed value as given in default mode, warning only where it differs', () => {
    const options = createChatInputOptions({ focused: 'query', query: 'ab' })

    expect(options.getString('query')).toBe('ab')
    expect(warned).toEqual([])
    expect(options.get('query')?.focused).toBeUndefined()
    expect(warned).toEqual([expect.stringMatching(/^The focused option "query" is read here from what the test gave/)])
  })
})
