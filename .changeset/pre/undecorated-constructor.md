---
'meocord': patch
---

A class whose constructor injects but which has no decorator is refused as the app is created, naming the class and the decorator to add, rather than with inversify's `Found unexpected missing metadata on type …` error, at startup or, for a guard, at its first call. The advice is the class's own: `@Controller()` for a listed controller; `@Guard()`, `@Interceptor()`, `@Catch()` or `@Pipe()` for a guard, interceptor, filter or pipe, global or on a handler; `@Service()`, or a provider in `@MeoCord({ providers })` for a class from a package, for any other. Injecting one of MeoCord's classes an app makes itself, such as `Logger` or an error, is refused saying how to make it instead. A subclass whose constructor takes its decorated base's types, a parameter with a default value and a rest parameter are created as before.
