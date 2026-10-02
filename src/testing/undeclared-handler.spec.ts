import { ChatInputCommandInteraction } from 'discord.js'
import { Catch, Controller, MeoCord } from '@src/decorator/index.js'
import { type ExceptionFilter } from '@src/interface/index.js'
import { createMockInteraction, inspectHandler, MeoCordTestingModule } from '@src/testing/index.js'

// A name no class declares has no stages of its own: only the app's global ones apply.

@Catch()
class GlobalFilter implements ExceptionFilter {
  catch() {}
}

@Controller()
class Plain {
  // An instance property, which no prototype declares
  assign = (_interaction: ChatInputCommandInteraction, params: unknown) => params
}

@MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, filters: [GlobalFilter] })
class App {}

describe('a name no class declares', () => {
  it('reports no guards, interceptors or cooldowns, and only the global filters', () => {
    const inspection = inspectHandler(Plain, 'missing' as never, { app: App })

    expect(inspection.guards).toEqual([])
    expect(inspection.interceptors).toEqual([])
    expect(inspection.filters).toEqual([GlobalFilter])
    expect(inspection.cooldowns).toEqual([])
  })

  it('runs through invoke when it is an instance function', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Plain] }).compile()
    const params = { untouched: true }

    const { ran } = await module.invoke(Plain, 'assign' as never, createMockInteraction(ChatInputCommandInteraction), params as never)

    expect(ran).toBe(true)
  })
})
