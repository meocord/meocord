---
'meocord': patch
---

MeoCord keeps its own metadata under keys beginning `meocord:`, so `SetMetadata` takes any key a 4.0 bot used, such as `'guards'` or `'commandType'`, and stores it as 4.0 did. It refuses only a key beginning `meocord:` and the two keys dependency injection reads, `design:paramtypes` and inversify's injectable flag. A 4.1 beta refused `'guards'`, `'commandType'` and `'inversify:container'`, so a 4.0 bot that set one of them failed to load.

Code that read MeoCord's guard list or a builder's command type under `'guards'` or `'commandType'` no longer finds them there. To read the guards a handler runs, use `inspectHandler` from `meocord/testing`.
