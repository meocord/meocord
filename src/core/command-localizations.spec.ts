import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord.js'
import { localizationProblems } from '@src/core/command-localizations.js'

const slash = (overrides: Record<string, unknown>) => ({ name: 'ban', type: ApplicationCommandType.ChatInput, ...overrides })

describe('localizationProblems', () => {
  it('accepts names and descriptions at their limits, and a null entry that clears a locale', () => {
    expect(
      localizationProblems(
        'ban',
        slash({ name_localizations: { ja: 'a'.repeat(32), id: null }, description_localizations: { ja: 'd'.repeat(100) } }),
      ),
    ).toEqual([])
  })

  it('refuses a name or description one character too long, or empty', () => {
    expect(
      localizationProblems(
        'ban',
        slash({ name_localizations: { ja: 'a'.repeat(33), id: '' }, description_localizations: { ja: 'd'.repeat(101) } }),
      ),
    ).toEqual([
      '"ban" name_localizations.ja: 33 characters (1 to 32)',
      '"ban" name_localizations.id: 0 characters (1 to 32)',
      '"ban" description_localizations.ja: 101 characters (1 to 100)',
    ])
  })

  it('refuses a value that is not a string, naming it', () => {
    expect(localizationProblems('ban', slash({ name_localizations: { ja: 42 } }))).toEqual([
      '"ban" name_localizations.ja: not a string (1 to 32)',
    ])
  })

  it('refuses a chat input name with spaces, capitals or symbols, and takes Devanagari and Thai', () => {
    const problems = localizationProblems(
      'ban',
      slash({ name_localizations: { ja: 'ban user', fr: 'Bannir', de: 'bann!', hi: 'प्रतिबंध', th: 'แบน' } }),
    )

    expect(problems).toHaveLength(3)
    expect(problems.join('\n')).toMatch(/ja.*\n.*fr.*\n.*de/)
  })

  // Discord lowercases by the locale's own rules: Turkish has a dotted capital İ
  it('reads lowercase as the locale does', () => {
    expect(localizationProblems('ban', slash({ name_localizations: { tr: 'yasakla' } }))).toEqual([])
    expect(localizationProblems('ban', slash({ name_localizations: { tr: 'İptal' } }))).toHaveLength(1)
  })

  // Its value is not checked: the locale is the problem, named once
  it('names a key that is not a Discord locale, even a malformed one, without throwing', () => {
    const tooLong = 'a'.repeat(101)
    expect(
      localizationProblems('ban', slash({ name_localizations: { en_US: tooLong, '!!': 'ban' }, description_localizations: { xx: tooLong } })),
    ).toEqual([
      '"ban" name_localizations.en_US: "en_US" is not a Discord locale',
      '"ban" name_localizations.!!: "!!" is not a Discord locale',
      '"ban" description_localizations.xx: "xx" is not a Discord locale',
    ])
  })

  it('lets a context menu name have spaces and capitals, and checks it no description', () => {
    expect(
      localizationProblems('Report', {
        name: 'Report',
        type: ApplicationCommandType.Message,
        name_localizations: { ja: 'Report Message' },
        description_localizations: { ja: '' },
      }),
    ).toEqual([])
  })

  // Discord caps every command's name and its localisations at 32 characters, and a choice's at 100
  it.each([ApplicationCommandType.User, ApplicationCommandType.Message, ApplicationCommandType.PrimaryEntryPoint])(
    'holds a type %i command name to 32 characters',
    type => {
      const name = (length: number) => `Report ${'x'.repeat(length - 7)}`
      expect(localizationProblems('Report', { name: 'Report', type, name_localizations: { ja: name(32) } })).toEqual([])
      expect(localizationProblems('Report', { name: 'Report', type, name_localizations: { ja: name(33) } })).toEqual([
        '"Report" name_localizations.ja: 33 characters (1 to 32)',
      ])
    },
  )

  it('holds a choice name to 100 characters', () => {
    const choice = (ja: string) => slash({ options: [{ name: 'when', choices: [{ name: 'daily', value: 'd', name_localizations: { ja } }] }] })
    expect(localizationProblems('ban', choice('x'.repeat(100)))).toEqual([])
    expect(localizationProblems('ban', choice('x'.repeat(101)))).toEqual([
      '"ban" options.when.choices.daily.name_localizations.ja: 101 characters (1 to 100)',
    ])
  })

  it('names a problem inside a subcommand group by its path, and checks choices as display text', () => {
    const problems = localizationProblems(
      'settings',
      slash({
        name: 'settings',
        options: [
          {
            name: 'notify',
            type: ApplicationCommandOptionType.SubcommandGroup,
            options: [
              {
                name: 'email',
                type: ApplicationCommandOptionType.Subcommand,
                description_localizations: { ja: '' },
                options: [{ name: 'when', choices: [{ name: 'daily', value: 'd', name_localizations: { ja: 'Every Day' } }] }],
              },
            ],
          },
        ],
      }),
    )

    expect(problems).toEqual(['"settings" options.notify.email.description_localizations.ja: 0 characters (1 to 100)'])
  })

  it('finds nothing in a command without localizations, or with null maps', () => {
    expect(localizationProblems('ban', slash({}))).toEqual([])
    expect(localizationProblems('ban', slash({ name_localizations: null, description_localizations: null }))).toEqual([])
  })
})
