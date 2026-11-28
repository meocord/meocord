---
'meocord': patch
---

An edit through `respond()` now keeps a message's uploaded files attachment-backed when it lists no attachments: `@Defer`'s lock and restore without loading files, and an app's own `send()` or `edit()` that re-sends the message's components or embeds. Their media point at the message's own uploads as `attachment://`, so a Components V2 gallery keeps its `attachment_id` and a File component is no longer refused with a 400. An app edit that adds `files` without listing `attachments` now keeps the uploads its components and embeds show beside the new files, where it dropped them before; with more than 10 files in all it keeps only the new ones, with a warning. An `attachments` list an app gives is sent as given, with each discord.js `Attachment` in it sent as `{ id, filename }`, the shape Discord needs to keep a Components V2 component's upload. To drop files, list the ones to keep, or pass `attachments: []`.
