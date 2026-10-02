import { GatewayIntentBits } from 'discord.js'
import {
  disallowedIntentsMessage,
  explainLoginFailure,
  fatalLoginCode,
  isRefusedToken,
  tokenMessage,
} from '@src/core/login-failure.js'

describe('fatalLoginCode', () => {
  it("reads discord.js's codes, and the gateway's close messages that arrive without one", () => {
    expect(fatalLoginCode(Object.assign(new Error('x'), { code: 'TokenInvalid' }))).toBe('TokenInvalid')
    expect(fatalLoginCode(Object.assign(new Error('x'), { code: 'DisallowedIntents' }))).toBe('DisallowedIntents')
    expect(fatalLoginCode(new Error('Used disallowed intents'))).toBe('DisallowedIntents')
    expect(fatalLoginCode(new Error('Used invalid intents'))).toBe('InvalidIntents')
  })

  it('reads nothing fatal from an error it does not know as fatal, or from anything not an Error', () => {
    expect(fatalLoginCode(new Error('getaddrinfo ENOTFOUND discord.com'))).toBeUndefined()
    expect(fatalLoginCode(Object.assign(new Error('x'), { code: 'TokenMissing' }))).toBeUndefined()
    expect(fatalLoginCode(undefined)).toBeUndefined()
    expect(fatalLoginCode('Used disallowed intents')).toBeUndefined()
  })
})

describe('disallowedIntentsMessage', () => {
  it('names exactly the privileged intents requested, in a fixed order', () => {
    const message = disallowedIntentsMessage([GatewayIntentBits.MessageContent, GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences])

    expect(message).toContain('(GuildPresences, MessageContent)')
    expect(message).not.toContain('GuildMembers')
    expect(message).not.toContain('Guilds,')
  })

  it('still says where to enable them when no privileged intent can be named', () => {
    expect(disallowedIntentsMessage(undefined)).toMatch(/^Discord refused a privileged intent the bot requests\. Enable them in the Developer Portal/)
  })
})

describe('explainLoginFailure', () => {
  it('explains refused intents and a refused or missing token', () => {
    expect(explainLoginFailure('DisallowedIntents', [GatewayIntentBits.GuildMembers], 'token')).toContain('(GuildMembers)')
    expect(explainLoginFailure('InvalidIntents', [], 'token')).toContain('as invalid')
    expect(explainLoginFailure('TokenInvalid', [], 'token')).toBe(tokenMessage('token'))
    expect(explainLoginFailure('TokenInvalid', [], '')).toBe(tokenMessage(''))
    expect(explainLoginFailure(undefined, [], 'token')).toBeUndefined()
  })
})

describe('tokenMessage', () => {
  it('says Discord refused a token that is set, and where to get a new one', () => {
    expect(tokenMessage('abc')).toMatch(/^Discord refused the bot token\. .*Developer Portal → your application → Bot → Reset Token/)
    expect(tokenMessage('abc')).toContain('DISCORD_TOKEN in .env')
  })

  it('says the token is missing when it is empty or only whitespace', () => {
    for (const token of [undefined, '', '  ']) {
      expect(tokenMessage(token)).toMatch(/^Discord token is missing: meocord\.config\.ts sets discordToken/)
      expect(tokenMessage(token)).toContain('Reset Token')
    }
  })
})

describe('isRefusedToken', () => {
  it("recognises discord.js's invalid token and a REST 401", () => {
    expect(isRefusedToken(Object.assign(new Error('An invalid token was provided.'), { code: 'TokenInvalid' }))).toBe(true)
    expect(isRefusedToken(Object.assign(new Error('401: Unauthorized'), { status: 401 }))).toBe(true)
  })

  it('leaves any other failure alone', () => {
    expect(isRefusedToken(Object.assign(new Error('Missing Access'), { status: 403 }))).toBe(false)
    expect(isRefusedToken(new Error('getaddrinfo ENOTFOUND discord.com'))).toBe(false)
    expect(isRefusedToken(undefined)).toBe(false)
  })
})
