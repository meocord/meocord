import path from 'path'
import { describeRefusal, isRefusal, refuse } from '@src/util/refusal.util.js'

describe('refuse', () => {
  it('marks the error it is given, leaving its class and message as they were', () => {
    const error = refuse(new TypeError('@MeoCord({ warnUnanswered }) on App takes true or false.'))

    expect(error).toBeInstanceOf(TypeError)
    expect(error.message).toBe('@MeoCord({ warnUnanswered }) on App takes true or false.')
    expect(isRefusal(error)).toBe(true)
  })

  it('tells a refusal from any other error, or a value that is not one', () => {
    expect(isRefusal(new Error('boom'))).toBe(false)
    expect(isRefusal('text')).toBe(false)
    expect(isRefusal(undefined)).toBe(false)
  })
})

describe('describeRefusal', () => {
  const root = path.join(path.sep, 'bots', 'shop')
  const withStack = (message: string, frames: string[]) => {
    const error = refuse(new Error(message))
    error.stack = [`Error: ${message}`, ...frames.map(frame => `    at ${frame}`)].join('\n')
    return error
  }

  it("names the first file of the app's own source, leaving out the library, the bundle, the entry and decorate helpers", () => {
    const error = withStack('Invalid pattern "a-{id}"', [
      `createRegexFromPattern (file://${root}/node_modules/meocord/dist/esm/decorator/controller.decorator.js:115:19)`,
      `${root}/dist/main.js:2:5718`,
      // The compiler's decorate helper, which a development build's source map places in whichever file it likes
      `_ts_decorate (${root}/src/app.ts:39:26)`,
      `Object../src/controllers/button/sample.button.controller.ts (${root}/src/controllers/button/sample.button.controller.ts:12:33)`,
      `<anonymous> (${root}/src/main.ts:17:1)`,
    ])

    expect(describeRefusal(error, root)).toBe('Invalid pattern "a-{id}"\n    in src/controllers/button/sample.button.controller.ts')
  })

  // Run on every platform: a Windows stack holds file:// URLs, whose drive letter can come back in either case
  it('names the file on Windows, from a file:// URL or a path, whatever case the drive letter is in', () => {
    const windowsRoot = 'C:\\bots\\shop'
    const error = refuse(new Error('Invalid pattern "a-{id}"'))
    error.stack = [
      'Error: Invalid pattern "a-{id}"',
      '    at createRegexFromPattern (file:///c:/bots/shop/node_modules/meocord/dist/esm/decorator/controller.decorator.js:115:19)',
      '    at _ts_decorate (file:///C:/bots/shop/src/app.ts:39:26)',
      '    at <anonymous> (file:///c:/bots/shop/src/main.ts:17:1)',
      '    at Object.x (file:///c:/Bots/Shop/src/controllers/button/sample.button.controller.ts:12:33)',
    ].join('\n')

    expect(describeRefusal(error, windowsRoot, true)).toBe(
      'Invalid pattern "a-{id}"\n    in src/controllers/button/sample.button.controller.ts',
    )

    error.stack = ['Error: x', '    at C:\\bots\\shop\\src\\services\\shop.service.ts:3:9'].join('\n')
    expect(describeRefusal(error, windowsRoot, true)).toBe('Invalid pattern "a-{id}"\n    in src/services/shop.service.ts')
  })

  it('gives the message alone when no frame is in the source', () => {
    const error = withStack('No @MeoCord() on App', [`${root}/dist/main.js:2:5718`, `<anonymous> (${root}/src/main.ts:17:1)`])

    expect(describeRefusal(error, root)).toBe('No @MeoCord() on App')
  })
})
