---
'meocord': patch
---

A message `@Defer` locked is put back when its handler answers only with a follow-up, returns without answering, or throws. On a message with an uploaded file, such as an image in a Components V2 card, a click soon after the message was sent could leave it locked instead: its buttons and selects disabled under the loading view, for good. The lock's edit has Discord process the uploaded file again, and MeoCord, seeing the message change from what its edit returned, took it for someone else's edit and left it alone. It now keeps the time Discord stamps on its own edit, and leaves a message as it is only when it shows a later edit. The file stays attached, and a select that was clicked comes back with its options and defaults as the message had them, not the user's pick.

`meocord/testing`: a mock interaction's `editReply()` and `fetchReply()` now keep its message as Discord does. Components get their ids, media resolves, a file uploaded with the message comes back loading from the first edit that keeps it, and each edit is stamped with its time. `createMockMessage` takes `editedTimestamp`.
