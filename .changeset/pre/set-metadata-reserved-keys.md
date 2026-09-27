---
'meocord': patch
---

`SetMetadata` refuses the keys MeoCord stores its own metadata under, such as `'guards'` and `'commandType'`, and throws when the decorator is created, naming the key. A value under `'guards'` replaced the guard list dispatch runs, so a handler decorated with `@SetMetadata('guards', …)` above its `@UseGuard` ran with none of its guards. Choose another key, or declare the decorator with `createMetadata`, whose key is unique; see [`SetMetadata` refuses MeoCord's own keys](https://meocord.dev/docs/4.1/migrating#setmetadata-refuses-meocords-own-keys).

A guard class listed in `@MeoCord({ services })` is warned about at startup: one shared instance takes every call's `{ provide, params }`.
