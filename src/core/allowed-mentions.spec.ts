import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { allowedMentionsWarning, UNSET_ALLOWED_MENTIONS_WARNING } from '@src/core/allowed-mentions.js'
import { Command, Controller, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

const TEMPLATE = path.join(import.meta.dirname, '..', 'bin', 'app-template', 'src', 'app.ts.template')

describe('allowedMentionsWarning', () => {
  it('warns about client options without allowedMentions', () => {
    expect(allowedMentionsWarning({ intents: [] })).toBe(UNSET_ALLOWED_MENTIONS_WARNING)
    expect(allowedMentionsWarning(undefined)).toBe(UNSET_ALLOWED_MENTIONS_WARNING)
  })

  it('says nothing once allowedMentions is set, to anything', () => {
    expect(allowedMentionsWarning({ intents: [], allowedMentions: {} })).toBeUndefined()
  })

  // So an app from the template never sees the warning, and its replies ping no one
  it("is silenced in the app template's clientOptions", () => {
    const clientOptions = /clientOptions: \{([\s\S]*?)\n {2}\},/.exec(readFileSync(TEMPLATE, 'utf8'))?.[1]

    expect(clientOptions).toContain('allowedMentions: { parse: [] },')
  })

  it('is not logged by a testing module', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    @Controller()
    class Ping {
      @Command('ping', CommandType.SLASH)
      ping() {}
    }
    @MeoCord({ controllers: [Ping], clientOptions: { intents: [] } })
    class App {}

    MeoCordTestingModule.fromApp(App).compile()

    expect(warn).not.toHaveBeenCalledWith(UNSET_ALLOWED_MENTIONS_WARNING)
    warn.mockRestore()
  })
})
