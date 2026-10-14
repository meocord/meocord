---
'meocord': patch
---

A message param or flag named like an `Object` member, such as `{__proto__}`, `{constructor:int?}` or `{toString?}`, is now its own key in the handler's params, as interaction options already are. `{__proto__}` and `{__proto__:int...}` were dropped or set as the params' prototype, `{__proto__:int}` and a left-out `{constructor:int?}` threw `TypeError: text.replace is not a function` on every message, and a left-out `{toString?}` or `{--constructor:int?}` handed the handler the inherited `Object.prototype` member. Each now reads the word, the value, or `undefined` when left out, and the params' prototype stays `Object.prototype`. An ordinary optional param left out is still absent from the params' keys.
