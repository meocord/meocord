---
'meocord': minor
---

`@MeoCord({ globalStagesOnEvents: false })` keeps the app's global guards and interceptors that declare no `types` from running before `@On` and `@Once` handlers. They still run for commands, components, modals, message commands, reactions and autocomplete, so a global blocklist or maintenance guard keeps covering message commands. A stage that declares `types` keeps exactly what it declares, `'event'` included; the guards and interceptors a controller or a handler names, and global exception filters, are unaffected. The default stays `true` in 4.3 and becomes `false` in the next major version (5.0), as [meocord#502](https://github.com/meocord/meocord/issues/502) plans.

The startup line that named each such stage is now a warning, once per stage, shown only when the app has event handlers and leaves the option unset. To silence it, declare `@Guard({ types: [...] })` or `@Interceptor({ types: [...] })` on the stage, or set `globalStagesOnEvents` to `true` to keep today's behaviour or to `false` to take 5.0's now. See https://meocord.dev/docs/4.3/guards.
