---
'meocord': minor
---

A typed message param's member, user, role or channel is fetched from Discord only once the handler's guards let the call through, so a caller they refuse, or one still on a cooldown that has no `by`, costs no request, however many IDs the message names. The guards see each such param as an `EntityRef`: its `id`, the entity as `cached` when discord.js already has it, and `resolve()` to fetch it; `ParamRefsOf<'pattern'>`, from `meocord/interface`, types the params that way. The handler, `@Validate`, pipes and `@Cooldown({ by })` get the entities, as before. Each ID is fetched once however many messages and guards ask for it at the same time. An app's own param type can return an `EntityRef` from `parse` to fetch after the guards too.
