---
'meocord': patch
---

A message pattern longer than 16 words, flags included, checks its handler's params past the sixteenth word, as `ParamsOf` and `CheckedParams` describe. A handler that declared such a param, which dispatch gives it, failed to compile with "The handler's params do not fit the pattern"; it now compiles, and a misspelt one is still caught.
