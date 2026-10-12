---
'meocord': patch
---

The `Jsonified` and `ShardContext.call` JSDoc say that an object arrives with its own fields only: a class's getters are left out by JSON, though `Jsonified` still types them, since TypeScript can't tell a getter from a field. Return a plain object, or give the class a `toJSON`, for a value with getters.
