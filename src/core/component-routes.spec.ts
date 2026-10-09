import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { buildComponentRoutes, findComponentRouteConflicts, matchComponentRoute } from '@src/core/component-routes.js'

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

  // One controller per pattern, so a test can list them in any order
  const controllerFor = (pattern: string) => {
    @Controller()
    class Routed {
      @Command(pattern, CommandType.BUTTON)
      handle() {}
    }
    return Routed
  }
  const winner = (patterns: string[], customId: string) =>
    matchComponentRoute(buildComponentRoutes(patterns.map(controllerFor)), () => true, customId)?.route.pattern

  // Only patterns the ranking leaves tied collide: the same literals, and params of equally narrow types, at each position
  it('reports tied patterns that can match one customId, with the one that runs and an id both match', () => {
    const routes = buildComponentRoutes(['t/{x:on|off}/c', 't/{y:off|no}/c', 't/{z:a|b}/c', 't/{s}/c', 't/{n:int}/c', 't/{b:bool}/c'].map(controllerFor))
    expect(findComponentRouteConflicts(routes)).toEqual([
      { type: CommandType.BUTTON, patterns: ['t/{x:on|off}/c', 't/{y:off|no}/c'], runs: 't/{x:on|off}/c', customId: 't/off/c' },
    ])
  })

  // Segment by segment, left to right: the first segment one pattern spells out and the other leaves to a param
  // decides; between patterns that leaves tied, the narrower type at the first param where they differ
  it.each([
    ['profile/{userId}/edit', 'profile/me/{section}', 'profile/me/edit', 'profile/me/{section}'],
    ['profile/{userId}/edit', 'profile/me/{section}', 'profile/123/edit', 'profile/{userId}/edit'],
    ['a/{x}', '{x}/abcd', 'a/abcd', 'a/{x}'],
    ['a/{x}/c', 'a/b/{y}', 'a/b/c', 'a/b/{y}'],
    ['{n:int}/{y}', '{s}/b', '7/b', '{s}/b'],
    ['{c:on|off}/{s}', 'on/{t}', 'on/z', 'on/{t}'],
    ['a/{s}', 'a/{n:int}', 'a/5', 'a/{n:int}'],
    ['a/{s}', 'a/{n:int}', 'a/x', 'a/{s}'],
    ['a/{n:number}', 'a/{n:int}', 'a/7', 'a/{n:int}'],
    ['{s}/{n:int}', '{n:int}/{s}', '7/7', '{n:int}/{s}'],
  ])('runs the better of %s and %s for %s, %s, whatever the listing', (first, second, customId, expected) => {
    expect(winner([first, second], customId)).toBe(expected)
    expect(winner([second, first], customId)).toBe(expected)
    expect(findComponentRouteConflicts(buildComponentRoutes([first, second].map(controllerFor)))).toEqual([])
  })

  // Every listing gives one order, so the ranking is transitive
  it.each([
    [['{z}/b/c', 'a/{x}/c', 'a/b/{y}']],
    [['a/b/{y}', '{z}/b/c', 'a/{x}/c']],
    [['a/{x}/c', 'a/b/{y}', '{z}/b/c']],
  ])('ranks %j the same whatever the listing', patterns => {
    expect(buildComponentRoutes(patterns.map(controllerFor)).map(route => route.pattern)).toEqual(['a/b/{y}', 'a/{x}/c', '{z}/b/c'])
  })

  it('runs the pattern listed first between two the ranking leaves tied', () => {
    expect(winner(['a/{x:on|off}', 'a/{y:off|no}'], 'a/off')).toBe('a/{x:on|off}')
    expect(winner(['a/{y:off|no}', 'a/{x:on|off}'], 'a/off')).toBe('a/{y:off|no}')
  })
})
