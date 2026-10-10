import { ButtonStyle } from 'discord.js'
import { assertValidTheme, RESERVED_THEME_ROLES, themeProblems } from '@src/core/theme-validation.js'

describe('themeProblems', () => {
  it('accepts every form a colour, an emoji and a button style may take', () => {
    expect(
      themeProblems({
        colors: { primary: '#7680F4', neutral: '7680f4', success: 0x26a042, warning: [176, 132, 0], danger: 'Red', info: 'Default', spare: 'Random' },
        emojis: {
          loading: '⏳',
          success: '✅',
          warning: '⚠️',
          danger: '<:nope:123456789012345678>',
          info: '<a:spin:123456789012345678>',
          flag: '🇮🇩',
          keycap: '1️⃣',
          family: '👨‍👩‍👧',
          skin: '👍🏽',
          // England, Scotland and Wales: a black flag, tag characters, and a cancel tag
          england: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
          scotland: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
          wales: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
        },
        buttons: { primary: ButtonStyle.Primary, neutral: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger },
      }),
    ).toEqual([])
  })

  it('refuses a theme or a group of MeoCord\'s that is not a plain object, which would replace what it merges over', () => {
    class Row {
      colors = { primary: '#000031' }
    }
    class Colours {
      primary = '#000032'
    }
    const unnamed = Object.create(Object.create(null))

    expect(themeProblems(new Row(), 'x')).toEqual([
      "x: theme must be a plain object of groups (got a Row): give a plain object, such as { ...value }, or a row's toObject(), since anything else would replace the whole theme",
    ])
    expect(themeProblems({ colors: new Colours() }, 'x')).toEqual([
      "x: theme.colors must be a plain object of roles (got a Colours): give a plain object, such as { ...value }, or a row's toObject(), since anything else would replace the whole group",
    ])
    expect(themeProblems(unnamed)).toEqual([
      "theme must be a plain object of groups (got an object without a plain prototype): give a plain object, such as { ...value }, or a row's toObject(), since anything else would replace the whole theme",
    ])
  })

  it('accepts an object with no prototype, as a plain object, at the root and as a group', () => {
    const root = Object.assign(Object.create(null), { colors: Object.assign(Object.create(null), { primary: '#7680F4' }) })

    expect(themeProblems(root)).toEqual([])
  })

  it('accepts a partial theme, and groups of the app its own', () => {
    expect(themeProblems({ colors: { danger: '#E3606D' } })).toEqual([])
    // An override may leave a group or a role undefined, as a spread of optional values does
    expect(themeProblems({ colors: undefined, emojis: { loading: undefined } })).toEqual([])
    expect(themeProblems({ charts: { axis: '#GGG', series: ['anything'] } })).toEqual([])
    expect(themeProblems({})).toEqual([])
  })

  it('names the key path and says what is wrong with each bad token', () => {
    expect(
      themeProblems({
        colors: { primary: '#GGG', neutral: '#FFF', success: [300, 0, 0], warning: [0, 0, 300], danger: -1, info: 0x1000000, vip: { r: 1 } },
        emojis: { loading: 'hourglass', success: ':white_check_mark:', warning: '<:name>', danger: '', info: 7 },
        buttons: { primary: ButtonStyle.Link, neutral: ButtonStyle.Premium, success: 0, danger: 'Danger' },
      }),
    ).toEqual([
      "theme.colors.primary: '#GGG' is not a colour: give a 6-digit hex string such as '#7680F4', a number from 0 to 0xFFFFFF, an [r, g, b] tuple of 0–255, or a discord.js colour name",
      "theme.colors.neutral: '#FFF' is not a colour: give a 6-digit hex string such as '#7680F4', a number from 0 to 0xFFFFFF, an [r, g, b] tuple of 0–255, or a discord.js colour name",
      'theme.colors.success: [300, 0, 0] is not a colour: give a 6-digit hex string such as \'#7680F4\', a number from 0 to 0xFFFFFF, an [r, g, b] tuple of 0–255, or a discord.js colour name',
      'theme.colors.warning: [0, 0, 300] is not a colour: give a 6-digit hex string such as \'#7680F4\', a number from 0 to 0xFFFFFF, an [r, g, b] tuple of 0–255, or a discord.js colour name',
      'theme.colors.danger: -1 is not a colour: give a 6-digit hex string such as \'#7680F4\', a number from 0 to 0xFFFFFF, an [r, g, b] tuple of 0–255, or a discord.js colour name',
      'theme.colors.info: 16777216 is not a colour: give a 6-digit hex string such as \'#7680F4\', a number from 0 to 0xFFFFFF, an [r, g, b] tuple of 0–255, or a discord.js colour name',
      'theme.colors.vip: an object is not a colour: give a 6-digit hex string such as \'#7680F4\', a number from 0 to 0xFFFFFF, an [r, g, b] tuple of 0–255, or a discord.js colour name',
      "theme.emojis.loading: 'hourglass' is not an emoji: give a unicode emoji, or a custom one written <:name:id> or <a:name:id>",
      "theme.emojis.success: ':white_check_mark:' is not an emoji: give a unicode emoji, or a custom one written <:name:id> or <a:name:id>",
      "theme.emojis.warning: '<:name>' is not an emoji: give a unicode emoji, or a custom one written <:name:id> or <a:name:id>",
      "theme.emojis.danger: '' is not an emoji: give a unicode emoji, or a custom one written <:name:id> or <a:name:id>",
      'theme.emojis.info: 7 is not an emoji: give a unicode emoji, or a custom one written <:name:id> or <a:name:id>',
      'theme.buttons.primary: 5 is not a button style a theme can map to: give ButtonStyle.Primary, Secondary, Success or Danger',
      'theme.buttons.neutral: 6 is not a button style a theme can map to: give ButtonStyle.Primary, Secondary, Success or Danger',
      'theme.buttons.success: 0 is not a button style a theme can map to: give ButtonStyle.Primary, Secondary, Success or Danger',
      "theme.buttons.danger: 'Danger' is not a button style a theme can map to: give ButtonStyle.Primary, Secondary, Success or Danger",
    ])
  })

  it('refuses a black flag with tag characters but no cancel tag', () => {
    expect(themeProblems({ emojis: { flag: '\u{1F3F4}\u{E0067}\u{E0062}' } })).toHaveLength(1)
  })

  it('shows a tuple of the wrong kind as written', () => {
    expect(themeProblems({ colors: { primary: ['1', '2', '3'] } })[0]).toMatch(/^theme\.colors\.primary: \['1', '2', '3'\] is not a colour/)
  })

  it('refuses a group that is not an object', () => {
    expect(themeProblems({ colors: 'red', emojis: null, buttons: [] })).toEqual([
      "theme.colors must be an object of roles (got 'red')",
      'theme.emojis must be an object of roles (got null)',
      'theme.buttons must be an object of roles (got an array)',
    ])
    expect(themeProblems('dark')).toEqual(["theme must be an object of groups (got 'dark')"])
  })

  // TypeScript refuses these at the root theme; a JavaScript app is told at startup instead
  it('refuses a role MeoCord reserves, in each of its groups', () => {
    expect(themeProblems({ colors: { accent: '#7680F4' }, emojis: { error: '❌' }, buttons: { link: ButtonStyle.Primary } })).toEqual([
      'theme.colors.accent: MeoCord reserves the role name accent for a role it may add; rename yours',
      'theme.emojis.error: MeoCord reserves the role name error for a role it may add; rename yours',
      'theme.buttons.link: MeoCord reserves the role name link for a role it may add; rename yours',
    ])
  })

  it('names where the theme came from', () => {
    expect(themeProblems({ colors: { primary: '#GGG' } }, '@UseTheme on ShopController')[0]).toMatch(/^@UseTheme on ShopController: theme\.colors\.primary: /)
  })
})

describe('assertValidTheme', () => {
  it('throws every problem at once, one per line', () => {
    expect(() => assertValidTheme({ colors: { primary: '#GGG' }, buttons: { danger: 5 } }, '@MeoCord({ theme }) on App')).toThrow(
      /^@MeoCord\(\{ theme \}\) on App: the theme has 2 problems:\n {2}theme\.colors\.primary: .*\n {2}theme\.buttons\.danger: /,
    )
  })

  it('says one problem in the singular', () => {
    expect(() => assertValidTheme({ buttons: { danger: 5 } }, 'x')).toThrow(/^x: the theme has 1 problem:\n/)
  })

  it('returns nothing for a valid theme', () => {
    expect(() => assertValidTheme({ colors: { primary: '#7680F4' } }, 'x')).not.toThrow()
  })
})

describe('RESERVED_THEME_ROLES', () => {
  it('lists the reserved names once each', () => {
    expect(new Set(RESERVED_THEME_ROLES).size).toBe(RESERVED_THEME_ROLES.length)
    expect([...RESERVED_THEME_ROLES].sort()).toEqual(
      ['accent', 'attention', 'brand', 'done', 'error', 'link', 'muted', 'premium', 'secondary', 'severe', 'subtle', 'tertiary'],
    )
  })
})
