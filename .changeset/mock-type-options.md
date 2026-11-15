---
'meocord': minor
---

A project can have its mocks' values type-checked. Merge `typedValues: true` into `MockTypeOptions` from `meocord/testing`, in a declaration file the tests compile with:

```ts
// src/types/meocord-testing.d.ts
import 'meocord/testing'

declare module 'meocord/testing' {
  interface MockTypeOptions {
    typedValues: true
  }
}
```

Every mock's `mockReturnValue`, `mockResolvedValue` and `mockImplementation` then take only what the mocked function returns, resolves to or is, and `mock.calls`, `mock.lastCall`, `mock.results` and `mock.settledResults` read as its own arguments and results. `mockResolvedValue(undefined)` stays allowed, since a mock's answers resolve to `undefined` by default. An overloaded method, such as `guild.members.fetch`, takes what any of its overloads gives. A partial fake such as `mockResolvedValue({ id })` is then refused; cast it where it is intended.

Without the declaration nothing changes: those values stay `any`. A project whose tests compile as both ESM and CommonJS declares it in a `.d.ts` and a `.d.cts`. MeoCord 5.0 types the values by default ([meocord#561](https://github.com/meocord/meocord/issues/561)). See [Mocks](https://meocord.dev/docs/4.3/mocks).
