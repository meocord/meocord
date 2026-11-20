---
'meocord': patch
---

A handler under `@Defer({ mode: 'auto' })` whose interaction was answered with a raw discord.js call logged the development warning "An interaction under `@Defer` was answered with a raw discord.js call" twice for one answer, once when the timer fired and again when the handler returned. It now logs it once, when MeoCord first finds the answer: at the timer, at the next answer made through `respond()`, or when the handler returns. A raw answer followed by one through `respond()` before the timer, which logged nothing, now logs it too.
