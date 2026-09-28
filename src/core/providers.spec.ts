import { providerMap, tokenName } from '@src/core/providers.js'
import { type Provider } from '@src/interface/index.js'

const where = '@MeoCord({ providers })'
const check = (provider: unknown) => () => providerMap([provider as Provider], where)

describe('providerMap', () => {
  it('refuses a provider it could not bind, naming what is wrong', () => {
    expect(check({ useValue: 1 })).toThrow(`${where}: a provider has no token: set provide to a class, a string or a symbol.`)
    expect(check(null)).toThrow('a provider has no token')
    expect(check({ provide: 'a', useClass: 'A' })).toThrow("@MeoCord({ providers }): the provider for 'a' has a useClass that is not a class.")
    expect(check({ provide: 'a', useFactory: 'make' })).toThrow("@MeoCord({ providers }): the provider for 'a' has a useFactory that is not a function.")
    expect(check({ provide: 'a', useFactory: () => 1, inject: [42] })).toThrow(
      "@MeoCord({ providers }): the provider for 'a' has an inject that is not a list of tokens.",
    )
    expect(check({ provide: 'a', useValue: 1, useFactory: () => 1 })).toThrow('needs exactly one of useValue, useClass and useFactory')
  })

  it('says a bare class needs no listing, and how to replace it', () => {
    class Accounts {}
    expect(check(Accounts)).toThrow(
      `${where}: Accounts is a class, not a provider: list a service in @MeoCord({ services }). To put something in its place, ` +
        'write { provide: Accounts, useValue } or { provide: Accounts, useClass }.',
    )
    expect(() => providerMap([Accounts as never], "the testing module's providers")).toThrow(
      "the testing module's providers: Accounts is a class, not a provider: a class a controller or service injects is bound " +
        'for you, so it needs no listing.',
    )
  })

  it('keeps a value of undefined, which is still a way to provide', () => {
    expect(providerMap([{ provide: 'a', useValue: undefined }], where).get('a')).toEqual({ provide: 'a', useValue: undefined })
  })
})

describe('tokenName', () => {
  it('names a class, a symbol and a string as errors show them', () => {
    class Storage {}
    expect(tokenName(Storage)).toBe('Storage')
    expect(tokenName(Symbol('Database'))).toBe('Symbol(Database)')
    expect(tokenName(Symbol())).toBe('a symbol')
    expect(tokenName('config')).toBe("'config'")
  })
})
