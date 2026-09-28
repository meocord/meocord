import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { buildComponentRoutes, findComponentRouteConflicts } from '@src/core/component-routes.js'

describe('component routes', () => {
  it('refuses two handlers with the same pattern, naming both', () => {
    @Controller()
    class Profile {
      @Command('profile/{uid}', CommandType.BUTTON)
      show() {}
    }
    @Controller()
    class Card {
      @Command('profile/{uid}', CommandType.BUTTON)
      open() {}
    }
    expect(() => buildComponentRoutes([Profile, Card])).toThrow(
      /Profile\.show: "profile\/\{uid\}" and "profile\/\{uid\}" in Card\.open match the same button customIds/,
    )
  })

  it('refuses patterns that differ only in their param names, in one controller too', () => {
    @Controller()
    class Profile {
      @Command('profile/{uid}/edit', CommandType.BUTTON)
      edit() {}

      @Command('profile/{id}/edit', CommandType.BUTTON)
      alsoEdit() {}
    }
    expect(() => buildComponentRoutes([Profile])).toThrow(/^Profile\.edit: .* in Profile\.alsoEdit match the same/)
  })

  it('refuses a base controller and its subclass registered together, which share every route', () => {
    @Controller()
    class Moderation {
      @Command('ban/{id}', CommandType.BUTTON)
      ban() {}
    }
    @Controller()
    class Admin extends Moderation {}
    expect(() => buildComponentRoutes([Moderation, Admin])).toThrow(/^Moderation\.ban: .* in Admin\.ban match the same/)
  })

  it('keeps one route for a handler declared under two spellings of one pattern', () => {
    @Controller()
    class Card {
      @Command('card/{id}', CommandType.BUTTON)
      @Command('card/{cardId}', CommandType.BUTTON)
      open() {}
    }
    const routes = buildComponentRoutes([Card])
    expect(routes.map(route => route.meta.methodName)).toEqual(['open'])
    expect(findComponentRouteConflicts(routes)).toEqual([])
  })

  it('allows the same pattern on different component types, which dispatch never confuses', () => {
    @Controller()
    class Feedback {
      @Command('feedback/{topic}', CommandType.BUTTON)
      open() {}

      @Command('feedback/{topic}', CommandType.MODAL_SUBMIT)
      submit() {}
    }
    expect(buildComponentRoutes([Feedback])).toHaveLength(2)
  })

  it('still only reports patterns that overlap without being the same', () => {
    @Controller()
    class Overlap {
      @Command('a/{x}/c', CommandType.BUTTON)
      one() {}

      @Command('a/b/{y}', CommandType.BUTTON)
      two() {}
    }
    const routes = buildComponentRoutes([Overlap])
    expect(findComponentRouteConflicts(routes)).toEqual([{ type: CommandType.BUTTON, patterns: ['a/{x}/c', 'a/b/{y}'] }])
  })
})
