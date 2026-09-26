---
'meocord': minor
---

A guard, interceptor, filter or pipe can declare the params it takes, `declare readonly params?: { channelIds: string[] }`, and every `{ provide, params }` for it is checked against that type: in `@UseGuard`, `@UseInterceptor`, `@UseFilter`, `@UsePipe` and `@MeoCord({ guards, interceptors, filters })`. A misspelt param, such as `channelId`, or one of the wrong type, fails to compile, where it failed at the first call. A class that declares none takes any params, as before.

A guard also has its params whole as `this.params`, besides each as a property of its own. An interceptor, filter or pipe, shared across calls, reads them typed with `context.getParams<StageParams<typeof X>>()`; `StageParams` is exported from `meocord/interface`.
