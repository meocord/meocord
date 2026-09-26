---
'meocord': minor
---

Class-level `@UseGuard`, `@UseInterceptor`, `@UseFilter` and `@Cooldown` on a controller also apply to the handlers a subclass declares itself, as they do in NestJS: a guard on an abstract `StaffController` now guards every command of a class that extends it, where the subclass's own handlers ran without it. Every handler gets the chain inherited handlers had: the subclass's class stages first, then each base's, then the method's, with filters tried and cooldowns counted from the base out. `@Controller({ inheritStages: false })` keeps a subclass's own handlers to its own class and method stages; the handlers it inherits keep their base's. `inspectHandler` lists the resolved chain, and a direct call to a guarded handler runs the same guards in the same order as dispatch.

Each handler's stages are resolved once, not on every call, so dispatch pays nothing for the chain. See [A base controller's class stages cover its subclasses](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#a-base-controllers-class-stages-cover-its-subclasses) in the upgrade guide.
