---
'meocord': minor
---

`ShardContext.call` types each result as it arrives: through JSON, as every mode passes it. `meocord/core` exports `Jsonified<T>`, the type a value has after that trip: a `Date` is a `string`, a `Map` or a `Set` is `{}`, a class with `toJSON()` is what it returns, and a function or `undefined` property is left out. A method returning `Promise<Date>` now gives `ShardCallResult<string>[]`, where it said `Date` and gave a string. Code that read the value as the method's own type changes to the JSON form.

The arguments take the same trip, so `call()` refuses a method whose params JSON would change, such as one taking a `Date`: the compile error says the argument arrives as JSON and names the type to declare (`string` for a `Date`). An `undefined` argument now arrives as `undefined`, where it arrived as `null`. `ShardContext` is new in 4.1, so only beta users see these changes.
