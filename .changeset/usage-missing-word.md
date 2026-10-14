---
'meocord': patch
---

A message command's usage reply names the word a message left out or replaced, as `close is missing`, instead of saying "The command has more words than it takes". This applies to a word that follows a param, such as `close` in `ticket {id} close` or `--now` in `run {env} --now`, so `!ticket 5` and `!ticket 5 open` are now told what to write. A word its param's type doesn't take, which left the message fitting no route, is named too: for `roll {a:int?} {b:int?}`, `!roll x y` gets `a: "x" is not a valid whole number`. A role's word is named only when it names none of the server's roles, since a role is also found by its name. Only a message with more words than the pattern takes is told it has too many. The replies use MeoCord's existing texts, so a catalog that translates them translates these too.
