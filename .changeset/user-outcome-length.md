---
'meocord': patch
---

A `UserError`, `GuardDeniedError` or `ValidationError` whose message is empty, or longer than Discord takes, is answered as the user's own outcome again, instead of failing as a bot fault with the generic danger-coloured answer and two error logs. The message is fitted before any presenter sees it, your own included:

- at most 4096 characters for an embed and 4000 for a Components V2 Text Display, title line included, cut to end in `…`;
- an empty message becomes MeoCord's generic error text.

A message command's plain-text reply is cut to 2000 characters, its warning emoji included. `PresentedError.message` documents the limit; a presenter that writes the message as its text needs no change.
