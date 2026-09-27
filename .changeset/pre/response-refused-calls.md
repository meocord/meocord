---
'meocord': patch
---

`getResponse(interaction).sent` counts only calls Discord accepted. A reply, update, edit or follow-up that Discord refused, such as a reply rejected with 10062 once the three seconds passed, used to count as sent, so a test of what the member sees after an expired interaction could pass while the member saw nothing. The refused call stays in `calls`, in the order it was made, and carries what it rejected with as `error`, the new optional field of `ResponseCall`: every call `respond()` makes, deferrals and modals included, is marked this way.
