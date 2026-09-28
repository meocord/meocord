---
'meocord': patch
---

The JSDoc says where every pipeline stage runs, so the API reference can show it on each entry. `@Guard`, `@Interceptor`, `@Catch` and `@Pipe` gain the `@pipeline` tag their `@UseGuard`, `@UseInterceptor`, `@UseFilter` and `@UsePipe` counterparts already had, and so do `GuardInterface`, `InterceptorInterface`, `ExceptionFilter`, `PipeInterface` and `DispatchObserver`. The stage names are those of the pipeline figure on meocord.dev: `@Observer` runs at `observers-start` and `observers-settled`, and `@Defer`'s second step at `defer-lock`.
