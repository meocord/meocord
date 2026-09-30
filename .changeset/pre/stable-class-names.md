---
'meocord': patch
---

A production build keeps every class's own name. Before, when two modules declared a class of the same name, even a helper that never reaches MeoCord, `meocord build --prod` renamed one of them, such as `Shop` to `shop_controller_Shop`. A development build and your tests kept `Shop`. So in production, cooldowns were counted under the renamed class, errors and logs named it, and `ExecutionContext.getClass().name` returned it.

- If a controller was renamed this way, its cooldowns start over once, when you deploy this version. Nothing to do: the counts under the old name expire on their own.
- Two classes of one name are now refused in production as they already were in development and tests. That covers two controllers where either uses `@Cooldown` or `@Once`, and any two controllers or services under process sharding. If your bot stops at startup with this refusal, rename one of the two classes; the message names it.
