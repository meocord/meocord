---
'meocord': patch
---

Every `meocord` command now prints its own help after a usage error, such as an unknown option or a missing argument, as `meocord` itself already did. `meocord start --bogus` printed only `error: unknown option '--bogus'`; it now follows that with `start`'s options, and the same holds for `build`, `register`, `create`, `show` and every `generate` command.
