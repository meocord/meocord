import { type MockInstance, vi } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { forgetHiddenValues, hideInLogs, Logger } from '@src/common/logger.js'
import { resetLogLevel } from '@src/common/log-level.js'

const VALUE = 'MTA0.a-value-the-size-of-a-credential.only-for-this-spec'

let logSpy: MockInstance<typeof console.log>
const printed = () => logSpy.mock.calls.map(call => call.map(part => stripVTControlCharacters(String(part))).join(' '))

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubEnv('MEOCORD_LOG_LEVEL', 'log')
  resetLogLevel()
  forgetHiddenValues()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetLogLevel()
  forgetHiddenValues()
})

describe('hideInLogs', () => {
  it('ignores a missing, empty or blank value, so every other line prints as it is', () => {
    hideInLogs(undefined)
    hideInLogs('')
    hideInLogs('   ')

    new Logger().log('Discord token is missing: meocord.config.ts sets discordToken')

    expect(printed()).toEqual([expect.stringMatching(/Discord token is missing: meocord\.config\.ts sets discordToken$/)])
  })

  it('ignores a value too short to be a credential, such as a placeholder, so ordinary words still print', () => {
    hideInLogs('token')
    hideInLogs('x')

    new Logger().log('the token is x')

    expect(printed()).toEqual([expect.stringMatching(/the token is x$/)])
  })

  it.each(['Bot', 'Bearer'])('hides the value with a %s prefix, and the value alone as discord.js keeps it', prefix => {
    hideInLogs(`  ${prefix} ${VALUE}  `)

    new Logger().log(`${prefix} ${VALUE}`, VALUE, { stored: VALUE })

    const [line] = printed()
    expect(line).not.toContain(VALUE)
    expect(line.match(/\[redacted\]/g)).toHaveLength(3)
  })

  it('hides a value registered twice once, as the same value', () => {
    hideInLogs(VALUE)
    hideInLogs(VALUE)

    new Logger().log(`one ${VALUE} two`)

    expect(printed()).toEqual([expect.stringMatching(/one \[redacted\] two$/)])
  })
})
