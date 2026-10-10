---
'meocord': patch
---

`@Command` and `route()` warn about a customId pattern with a brace pair that isn't a param, such as `profile/{café}`: a param's name is ASCII letters, digits and `_`, so the pair is matched as literal text and a click on `profile/123` never reaches the handler. The pattern matches as before; rename the param, such as to `{cafe}`, to capture the segment.
