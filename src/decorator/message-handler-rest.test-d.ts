import { describe, it } from 'vitest'
import { type Message } from 'discord.js'
import { MessageHandler } from '@src/decorator/index.js'

/** Runs under `vitest --typecheck`: rest and optional parameters on a patterned message handler. */
describe('@MessageHandler(pattern) with rest or optional parameters', () => {
  it('compiles a rest of any length after the message, or after the message and fitting params', () => {
    class Dice {
      @MessageHandler('roll {sides:int}')
      rest(_message: Message, ..._rest: unknown[]) {
        return undefined
      }

      @MessageHandler('roll {sides:int}')
      words(_message: Message, ..._rest: string[]) {
        return undefined
      }

      @MessageHandler('roll {sides:int}')
      anything(..._args: unknown[]) {
        return undefined
      }

      @MessageHandler('roll {sides:int}')
      paramsThenRest(_message: Message, _params: { sides: number }, ..._rest: unknown[]) {
        return undefined
      }

      @MessageHandler('roll {sides:int}')
      paramsThenWords(_message: Message, _params: { sides: number }, ..._rest: string[]) {
        return undefined
      }

      @MessageHandler('roll {sides:int}')
      paramsAsTuple(_message: Message, ..._rest: [{ sides: number }]) {
        return undefined
      }

      @MessageHandler('roll {sides:int}')
      optionalParams(_message: Message, _params?: { sides: number }) {
        return undefined
      }
    }
    void Dice
  })

  it('still checks the params, and refuses a parameter after them', () => {
    class Dice {
      // @ts-expect-error side is not a param of the pattern
      @MessageHandler('roll {sides:int}')
      paramsThenRest(_message: Message, _params: { side: number }, ..._rest: unknown[]) {
        return undefined
      }

      // @ts-expect-error side is not a param of the pattern
      @MessageHandler('roll {sides:int}')
      paramsAsTuple(_message: Message, ..._rest: [{ side: number }]) {
        return undefined
      }

      // @ts-expect-error a message handler takes the message and its params, and nothing more
      @MessageHandler('roll {sides:int}')
      extra(_message: Message, _params: { sides: number }, _extra: string) {
        return undefined
      }
    }
    void Dice
  })
})
