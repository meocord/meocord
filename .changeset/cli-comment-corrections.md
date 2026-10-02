---
'meocord': patch
---

Corrections to comments that ship with the package and in a new app; no behaviour changes.

- The `meocord/eslint` example ignores generated code, in place of `coverage`, which the config already ignores.
- In a new app, the comments in `vitest.config.ts` give the reasons that apply to the versions it installs, `src/types/theme.d.ts` explains the theme augmentation in three lines, and the sample message controller's TODO reads correctly. The sample slash, modal and guard spec titles say only what their tests check.
- `meocord generate`: the guard template lists `'autocomplete'` among the handler kinds it can limit itself to, the interceptor template says interceptors skip autocomplete, and the filter template says `response` is undefined for autocomplete too.
