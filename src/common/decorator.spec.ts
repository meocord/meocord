import { SetMetadata } from '@src/common/index.js'
import { UseGuard, Guard } from '@src/decorator/index.js'
import { type GuardInterface } from '@src/interface/index.js'

describe('SetMetadata', () => {
  it.each(['guards', 'commandType', 'design:paramtypes', 'inversify:container', 'meocord:app-options', '@inversifyjs/core/classIsInjectableFlagReflectKey'])(
    'refuses the key MeoCord keeps its own metadata under, %s',
    key => {
      const applied = () => {
        @SetMetadata(key, [])
        class Shop {}
        return Shop
      }
      expect(applied).toThrow(`Shop: SetMetadata cannot use the key "${key}"`)
      expect(applied).toThrow('createMetadata')
    },
  )

  // Written above @UseGuard, it once replaced the guard list dispatch reads, so the guard never ran.
  it('cannot empty the guards a handler runs', () => {
    @Guard()
    class Deny implements GuardInterface {
      canActivate() {
        return false
      }
    }

    expect(() => {
      class Controller {
        @SetMetadata('guards', [])
        @UseGuard(Deny)
        async ping() {}
      }
      return Controller
    }).toThrow('SetMetadata cannot use the key "guards"')
  })

  it('stores any other key', () => {
    class Tagged {
      @SetMetadata('audit', true)
      method() {}
    }

    expect(Reflect.getMetadata('audit', Tagged.prototype, 'method')).toBe(true)
  })
})
