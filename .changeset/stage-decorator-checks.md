---
'meocord': patch
---

A `@Catch` given something that is not an error class, such as an `undefined` from an import cycle, is named in a warning as the filter loads, and now matches no error: `Broken: @Catch's first entry, undefined, which matches no error, is deprecated; in the next major version (5.0) it is refused. Use an error class, such as @Catch(CooldownError), instead.` It used to throw "Right-hand side of 'instanceof' is not an object" at the first error to reach the filter, which hid the handler's own error and handled the call a second time. The bot still starts; in 5.0 it is refused.
