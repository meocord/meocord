---
'meocord': patch
---

A `@Catch` given something that is not an error class, such as an `undefined` from an import cycle, is named in a warning as the filter loads, and now matches no error: `Broken: @Catch takes error classes, and its first is undefined, so it matches no error. In the next major version (5.0) this is refused. Give the class, such as @Catch(CooldownError).` It used to throw "Right-hand side of 'instanceof' is not an object" at the first error to reach the filter, which hid the handler's own error and handled the call a second time. The bot still starts; in 5.0 it is refused.
