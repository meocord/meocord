---
'meocord': patch
---

An `attachments` list given to `respond()`'s `send()` or `edit()` is still sent as given, but MeoCord now warns when it leaves out uploads the edit's media still show, naming them: that media is sent as given and breaks, a gallery reading back not found and a File component refused, so remove it too or keep its upload listed. An app listing `[...message.attachments.values()]` on a Components V2 message hits this, since that list holds only the uploads nothing shows. An entry with only the `id` of one of the message's own uploads is now sent as `{ id, filename }`, which Discord needs to keep a Components V2 component's upload. `respond(interaction).original`'s documentation now says to re-send its components through `send()` or `edit()`: a direct `interaction.editReply()` sends their CDN URLs as they are.
