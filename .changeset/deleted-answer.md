---
'meocord': patch
---

`respond()` keeps track of which message is the answer, so it no longer edits or deletes a reply that is gone, which Discord refused with 10008 (Unknown Message):

- After `delete()`, `send()`, `edit()`, an error answer and `followUp()` send a follow-up, which becomes the answer that later `send()`, `edit()` and `delete()` act on. A follow-up that takes the place of an edit is private when the deleted answer was, unless the payload sets `flags`. `message` is `undefined` until something is sent, and a second `delete()` with nothing sent since throws.
- After a private `followUp()` on a public deferral, which deletes the deferral, the follow-up is the answer: `send()` and `edit()` edit it, `delete()` deletes it, and `message` is it.

A test that expected `editReply` in these sequences now sees a `followUp`, or an edit of the follow-up by its id.
