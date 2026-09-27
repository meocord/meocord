---
'meocord': patch
---

A message command's usage reply reads right for every param type: a word of the wrong type is now `"lots" is not a valid whole number`, so an app's own type labelled with a noun such as `emoji` reads `is not a valid emoji`, where it read `is not a emoji`. A `bool` param is named a `yes or no answer`. A `MessageParamType`'s `label` is the bare noun, such as `hex colour`, as its example now shows. A test that matches the old wording, such as `is not a whole number`, needs the new one.
