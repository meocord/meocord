import { chai } from 'vitest'

// Vitest's toThrow('message'), toThrow(/pattern/) and toThrowError(...) pass when the code throws
// undefined or null, so a message assertion cannot tell an error from no error at all:
// https://github.com/vitest-dev/vitest/issues/7260. These wrappers fail that case and otherwise defer to
// Vitest. Delete this file, and its entries in the vitest configs, once the issue is fixed.

const { flag } = chai.util

/** Whether an expectation names the error it wants, which a thrown null or undefined can never be. */
const namesAnError = (expected: unknown): boolean => typeof expected === 'string' || expected instanceof RegExp || expected instanceof Error

for (const name of ['toThrow', 'toThrowError']) {
  chai.util.overwriteMethod(
    chai.Assertion.prototype,
    name,
    (original: (...args: unknown[]) => unknown) =>
      function (this: Chai.AssertionStatic, ...args: unknown[]) {
        const [expected] = args
        if (!namesAnError(expected) || flag(this, 'negate')) return original.apply(this, args)

        const subject: unknown = flag(this, 'object')
        const describe = (value: unknown) => `expected an error matching ${String(expected)}, but ${String(value)} was thrown`

        // `.rejects` hands over the rejection reason itself
        if (flag(this, 'promise') === 'rejects') {
          if (subject === null || subject === undefined) throw new chai.AssertionError(describe(subject))
          return original.apply(this, args)
        }
        if (typeof subject !== 'function') return original.apply(this, args)

        // Call it once here, and let Vitest judge the same outcome
        let outcome: { threw: true; error: unknown } | { threw: false; value: unknown }
        try {
          outcome = { threw: false, value: (subject as () => unknown)() }
        } catch (error) {
          outcome = { threw: true, error }
        }
        if (outcome.threw && (outcome.error === null || outcome.error === undefined)) {
          throw new chai.AssertionError(describe(outcome.error))
        }
        flag(this, 'object', () => {
          if (outcome.threw) throw outcome.error
          return outcome.value
        })
        return original.apply(this, args)
      },
  )
}

// The first use of ICU in a process loads its data, a one-time cost. Done here, once per worker, so setup pays it
// rather than whichever test first collates, formats a list, picks a plural form or lowercases for a locale.
'a'.localeCompare('b')
new Intl.ListFormat('en-US').format(['a', 'b'])
new Intl.PluralRules('en-US').select(1)
'A'.toLocaleLowerCase('en-US')
