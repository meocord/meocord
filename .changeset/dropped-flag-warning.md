---
'meocord': patch
---

The development warning `respond()` gives when it drops a flag a call can't take now names the call correctly, as in "which an update cannot take" and "which an edit cannot take". When the dropped flag is `Ephemeral` on an update or an edit, it also says how to answer only the member: with `respond(interaction).followUp()` and `MessageFlags.Ephemeral`, since a component's first `send()` updates the message the member clicked, for everyone. A test that pins the warning's text sees the new wording.
