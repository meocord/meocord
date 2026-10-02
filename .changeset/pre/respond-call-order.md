---
'meocord': patch
---

`respond()` makes the answers of one interaction one after another, and keeps its state right when Discord refuses one.

- Answers asked for together, such as two `send()` calls at once or the fallback's error while a `send()` is in flight, run in the order they were made: the first replies and the next edits or follows up, instead of both replying.
- An acknowledgement that fails leaves the interaction unanswered, so the next `send()` replies instead of throwing that failure again.
- A reply or an update Discord refuses as already acknowledged still throws, and the next `send()` edits. The error answer MeoCord follows up with after such a refusal now reaches Discord.
- `send()`, `edit()` and `delete()` after `modal()` throw an error saying to answer the modal's submit, since a modal has no message. `modal()` also throws while another answer is in flight.
- In `meocord/testing`, a mock command that showed a modal rejects `editReply()`, `fetchReply()` and `deleteReply()` with `Unknown Message` (10008).
