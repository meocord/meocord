import { describe, it } from 'vitest'
import { createTranslator, defineCatalog, Theme, type Translator, UserError } from '@src/common/index.js'
import { Service } from '@src/decorator/index.js'
import { type PresentedError, type ResponseContext, type ResponsePresenter, type ResponseView } from '@src/interface/index.js'

/** Runs under `vitest --typecheck`: the docs' and the JSDoc's `UserError` examples compile. */

const en = defineCatalog({ shop: { poor: 'You need {missing} more coins.' } })
void createTranslator({ default: 'en-US', locales: { 'en-US': en } })

describe('UserError', () => {
  it("compiles the JSDoc's example", () => {
    const [balance, price] = [3, 10]
    if (balance < price) {
      void new UserError(`You need ${price - balance} more coins.`, { code: 'shop.poor', context: { missing: price - balance } })
    }
  })

  it("compiles the docs' presenter", () => {
    @Service()
    class AppPresenter implements ResponsePresenter {
      constructor(private readonly t: Translator<typeof en>) {}

      loading(): ResponseView {
        return { text: 'Working on it…' }
      }

      error({ interaction }: ResponseContext, { message, error }: PresentedError): ResponseView {
        const text =
        error instanceof UserError && error.code === 'shop.poor'
          ? this.t.for(interaction)('shop.poor', { missing: Number(error.context?.missing) })
          : message
        return { title: 'Oops!', text, color: Theme.errorColor }
      }
    }
    void AppPresenter
  })
})
