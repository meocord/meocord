---
'meocord': patch
---

`@Cooldown` now warns, naming the handler, when it is given a `bypass` that is not a function, such as `true`, which fails every call through the handler, or a `seconds` that is not a number, such as `'5'`, which it reads as one. Both get past the types only from JavaScript or through a cast. They still decorate as before, and the next major version (5.0) refuses them; give `bypass` a function and `seconds` a number to silence the warning. A `bypass` of `false` or `null` still means none.
