---
'meocord': patch
---

`createMockClient()` is typed as a logged-in client, `DeepMocked<Client<true>>`, as the mock already behaves. Pass it straight to `createMockInteraction`, `createMockChannel`, `createMockUser` or `module.init({ ready: { client } })`: each of these failed to compile without a cast, since an interaction's client is `Client<true>`. `client.user` is no longer nullable, so `client.user!.id` can be `client.user.id`. Remove any `as unknown as Client<true>` cast on the mock.
