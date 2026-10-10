import { route } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Logger } from '@src/common/logger.js'
import { Command, Controller } from '@src/decorator/index.js'
import { createRegexFromPattern } from '@src/decorator/controller.decorator.js'
import { CommandType } from '@src/enum/index.js'

/** What MeoCord warns as `make` runs. */
function warnings(make: () => unknown): string[] {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  try {
    make()
    return warn.mock.calls.map(([message]) => String(message))
  } finally {
    warn.mockRestore()
  }
}

/** A controller whose handler is declared on `name`. */
const declared = (name: string | ReturnType<typeof route>) => () => {
  @Controller()
  class Profile {
    @Command(name, CommandType.BUTTON)
    show() {}
  }
  return Profile
}

const TAIL = "isn't a param, since a param's name is ASCII letters, digits and _; it is matched as literal text."

// A param's name is ASCII `\w`, so braces around anything else are text
describe('a brace pair that is not a param', () => {
  beforeEach(() => forgetDeprecationWarnings())

  it.each(['profile/{café}', 'profile/{名前}', 'profile/{a-b}', 'profile/{}'])('is warned about once by @Command: %s', pattern => {
    const brace = pattern.slice(pattern.indexOf('{'))

    expect(warnings(declared(pattern))).toEqual([`Profile.show: in the pattern "${pattern}", ${brace} ${TAIL}`])
  })

  it('is warned about once by route(), and not again by @Command given the route', () => {
    expect(warnings(() => declared(route('profile/{café}'))())).toEqual([`Pattern "profile/{café}": {café} ${TAIL}`])
  })

  it('is warned about once by route() for a pattern made again, as inside a handler', () => {
    expect(warnings(() => [route('profile/{café}'), route('profile/{café}')])).toEqual([`Pattern "profile/{café}": {café} ${TAIL}`])
  })

  it('names every such pair of a pattern in one warning', () => {
    expect(warnings(() => route('{é}/{ü}'))).toEqual([
      `Pattern "{é}/{ü}": {é}, {ü} aren't params, since a param's name is ASCII letters, digits and _; they are matched as literal text.`,
    ])
  })

  it('still matches as literal text', () => {
    const { regex, params } = createRegexFromPattern('profile/{café}')

    expect(params).toEqual([])
    expect(regex.test('profile/{café}')).toBe(true)
    expect(regex.test('profile/123')).toBe(false)
  })

  it.each(['profile/{id}', 'profile/{id:int}', 'profile/{__proto__}', 'profile/static'])('is not found in %s', pattern => {
    expect(warnings(declared(pattern))).toEqual([])
    expect(warnings(() => route(pattern))).toEqual([])
  })
})
