import { vi } from 'vitest'
import { ButtonInteraction } from 'discord.js'
import { Command, Controller } from '@src/decorator/index.js'
import { useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const seen: string[] = []
let release = () => {}
const press = () => createMockInteraction(ButtonInteraction, { customId: 'press' })

@Controller()
class Waiting {
  @Command('press', CommandType.BUTTON)
  async press() {
    seen.push(`before ${useTheme().colors.primary}`)
    await new Promise<void>(resolve => (release = resolve))
    seen.push(`after ${useTheme().colors.primary}`)
  }
}

@Controller()
class Reading {
  @Command('press', CommandType.BUTTON)
  press() {
    seen.push(`inside ${useTheme().colors.primary}`)
  }
}

const OTHER = '#BB0000'
const OWN = '#00BB00'
const defaults = DEFAULT_THEME.colors.primary

beforeEach(() => {
  seen.length = 0
})

// A file of its own: a module that claims the theme read outside calls keeps it until it is closed
describe("a call's theme", () => {
  it('is the one it started with, when another app claims the theme read outside calls while it runs', async () => {
    const waiting = MeoCordTestingModule.create({ controllers: [Waiting] }).compile()
    const call = waiting.invoke(Waiting, 'press', press())
    await vi.waitFor(() => expect(seen).toEqual([`before ${defaults}`]))

    const other = await MeoCordTestingModule.create({}).overrideTheme({ colors: { primary: OTHER } }).compile().init({ ready: true })
    release()
    await call

    expect(seen).toEqual([`before ${defaults}`, `after ${defaults}`])
    await other.close()
  })

  it("is the app's own when the app owns the theme read outside calls", async () => {
    const owner = await MeoCordTestingModule.create({ controllers: [Reading] })
      .overrideTheme({ colors: { primary: OWN } })
      .compile()
      .init({ ready: true })

    await owner.invoke(Reading, 'press', press())

    expect(seen).toEqual([`inside ${OWN}`])
    expect(useTheme().colors.primary).toBe(OWN)
    await owner.close()
  })

  it("is MeoCord's defaults for an app on them alone, inside and outside its calls", async () => {
    const alone = MeoCordTestingModule.create({ controllers: [Reading] }).compile()

    await alone.invoke(Reading, 'press', press())

    expect(seen).toEqual([`inside ${defaults}`])
    expect(useTheme().colors.primary).toBe(defaults)
  })
})
