---
'meocord': minor
---

`ShardContext.call` types each result as it arrives: through JSON, as every mode passes it. `meocord/core` exports `Jsonified<T>`, the type a value has after that trip: a `Date` is a `string`, a `Map` or a `Set` is `{}`, a class with `toJSON()` is what it returns, and a function or `undefined` property is left out. A method returning `Promise<Date>` now gives `ShardCallResult<string>[]`, where it said `Date` and gave a string. Code that read the value as the method's own type changes to the JSON form; `ShardContext` is new in 4.1, so only beta users see this.
