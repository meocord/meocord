import { describe, it } from 'vitest'
import { type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js'
import { Command, Pipe, UsePipe, Validate } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type PipeInterface, type Piped, type StandardSchemaV1 } from '@src/interface/index.js'

/** A Standard Schema of the given output, as any compliant library would produce. */
function schemaOf<Output>(): StandardSchemaV1<unknown, Output> {
  return { '~standard': { version: 1, vendor: 'test', validate: value => ({ value: value as Output }) } }
}

class Account {
  constructor(readonly uid: string) {}
}

@Pipe()
class AccountPipe implements PipeInterface<string, Account> {
  transform(uid: string): Account {
    return new Account(uid)
  }
}

@Pipe()
class AsyncAccountPipe implements PipeInterface<string, Promise<Account>> {
  async transform(uid: string): Promise<Account> {
    return new Account(uid)
  }
}

@Pipe()
class TrimPipe implements PipeInterface<string, string> {
  transform(value: string): string {
    return value.trim()
  }
}

const reminder = schemaOf<{ minutes: number; note?: string }>()
const profile = schemaOf<{ uid: string; tab: 'stats' | 'items' }>()

describe('@Validate on its own', () => {
  it('accepts params that match the schema output, or a part of it', () => {
    class Controller {
      @Validate(reminder)
      async all(_interaction: ChatInputCommandInteraction, _params: { minutes: number; note?: string }) {
        void _params
      }

      @Validate(reminder)
      async some(_interaction: ChatInputCommandInteraction, _params: { minutes: number }) {
        void _params
      }
    }
    void Controller
  })

  it('rejects a param of the wrong type', () => {
    class Controller {
      // @ts-expect-error minutes is a number
      @Validate(reminder)
      async handle(_interaction: ChatInputCommandInteraction, _params: { minutes: string }) {
        void _params
      }
    }
    void Controller
  })

  it('rejects a param the schema does not produce', () => {
    class Controller {
      // @ts-expect-error the schema has no `hours`
      @Validate(reminder)
      async handle(_interaction: ChatInputCommandInteraction, _params: { hours: number }) {
        void _params
      }
    }
    void Controller
  })

  it('rejects a required param the schema leaves optional', () => {
    class Controller {
      // @ts-expect-error `note` may be missing
      @Validate(reminder)
      async handle(_interaction: ChatInputCommandInteraction, _params: { note: string }) {
        void _params
      }
    }
    void Controller
  })

  it('refuses something that is not a Standard Schema', () => {
    // @ts-expect-error a plain object is not a schema
    void Validate({ minutes: 'number' })
  })
})

describe('@Validate with its own pipes', () => {
  it('types each piped key as its pipe output, and the rest as the schema output', () => {
    class Controller {
      @Validate(profile, { pipes: { uid: AccountPipe } })
      async handle(_interaction: ButtonInteraction, _params: { uid: Account; tab: 'stats' | 'items' }) {
        void _params
      }

      @Validate(profile, { pipes: { uid: AsyncAccountPipe } })
      async awaited(_interaction: ButtonInteraction, _params: { uid: Account }) {
        void _params
      }

      @Validate(profile, { pipes: { uid: [TrimPipe, AccountPipe] } })
      async chained(_interaction: ButtonInteraction, _params: { uid: Account }) {
        void _params
      }

      @Validate(profile, { pipes: { uid: { provide: AccountPipe, params: { region: 'eu' } } } })
      async withParams(_interaction: ButtonInteraction, _params: { uid: Account }) {
        void _params
      }
    }
    void Controller
  })

  it('rejects the pre-pipe type for a piped key', () => {
    class Controller {
      // @ts-expect-error uid is an Account once piped
      @Validate(profile, { pipes: { uid: AccountPipe } })
      async handle(_interaction: ButtonInteraction, _params: { uid: string }) {
        void _params
      }
    }
    void Controller
  })

  it('rejects a pipe for a key the schema does not produce', () => {
    // @ts-expect-error the schema has no `id`
    void Validate(profile, { pipes: { id: AccountPipe } })
  })
})

describe('@Validate with a separate @UsePipe', () => {
  it('accepts the piped key marked Piped', () => {
    class Controller {
      @Validate(profile)
      @UsePipe('uid', AccountPipe)
      async handle(_interaction: ButtonInteraction, _params: { uid: Piped<Account>; tab: 'stats' | 'items' }) {
        void _params
      }
    }
    void Controller
  })

  it('still checks the unmarked keys against the schema', () => {
    class Controller {
      // @ts-expect-error tab is 'stats' | 'items'
      @Validate(profile)
      @UsePipe('uid', AccountPipe)
      async handle(_interaction: ButtonInteraction, _params: { uid: Piped<Account>; tab: number }) {
        void _params
      }
    }
    void Controller
  })

  it('rejects an unmarked piped key', () => {
    class Controller {
      // @ts-expect-error mark uid Piped<Account>, or give the pipe to @Validate
      @Validate(profile)
      @UsePipe('uid', AccountPipe)
      async handle(_interaction: ButtonInteraction, _params: { uid: Account }) {
        void _params
      }
    }
    void Controller
  })

  it("checks the marked key against the pipe's output", () => {
    class Controller {
      @Validate(profile)
      // @ts-expect-error TrimPipe produces a string, not an Account
      @UsePipe('uid', TrimPipe)
      async handle(_interaction: ButtonInteraction, _params: { uid: Piped<Account> }) {
        void _params
      }
    }
    void Controller
  })
})

describe('@UsePipe without a schema', () => {
  it("types the key as the last pipe's output", () => {
    class Controller {
      @UsePipe('uid', AccountPipe)
      async one(_interaction: ButtonInteraction, _params: { uid: Account }) {
        void _params
      }

      @UsePipe('uid', TrimPipe, AccountPipe)
      async chained(_interaction: ButtonInteraction, _params: { uid: Account }) {
        void _params
      }
    }
    void Controller
  })

  it('rejects a key the handler params lack, and a mismatched output', () => {
    class Controller {
      // @ts-expect-error the params have no `uid`
      @UsePipe('uid', AccountPipe)
      async missing(_interaction: ButtonInteraction, _params: { id: string }) {
        void _params
      }

      // @ts-expect-error AccountPipe produces an Account
      @UsePipe('uid', AccountPipe)
      async wrong(_interaction: ButtonInteraction, _params: { uid: string }) {
        void _params
      }
    }
    void Controller
  })
})

describe('with @Command', () => {
  it('composes with the routing decorator, in either order', () => {
    class Controller {
      @Command('remind', CommandType.SLASH)
      @Validate(reminder)
      async remind(_interaction: ChatInputCommandInteraction, _params: { minutes: number }) {
        void _params
      }

      @Validate(profile, { pipes: { uid: AccountPipe } })
      @Command('profile/{uid}', CommandType.BUTTON)
      async profile(_interaction: ButtonInteraction, _params: { uid: Account }) {
        void _params
      }
    }
    void Controller
  })
})
