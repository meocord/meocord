---
'meocord': patch
---

A `{name:duration}` param given a word too long to add up, such as hundreds of digits before `s`, is a usage error naming the param, as a number too large is for `{name:number}`. The handler was given `Infinity`, which `setTimeout`, a `Date` or Discord mishandles.
