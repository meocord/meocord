---
'meocord': patch
---

A message command's usage reply now quotes a word with the spaces around it, as typed. A word in quotes keeps those spaces, and a typed param refuses them, so `!num " 12 "` was answered `n: "12" is not a valid number`, quoting a valid number as the invalid one. It now reads `n: " 12 " is not a valid number`, and the same holds for a choice word such as `"on "` and a flag's value such as `--loud=" yes"`. Each run of whitespace still reads as one space, so the reply stays on one line.
