---
"@tailorkit/react": minor
"@tailorkit/client-core": minor
"@tailorkit/app": patch
"tailorkit": minor
---

Rename `Slot` to `RenderSlot` (including client-bound `RenderSlot.Controlled`) and replace its `name` prop with `slot`. Rename the public types to `RenderSlotProps`, `ControlledRenderSlotProps`, `RuntimeRenderSlotProps`, `RenderSlotContext`, and `RenderSlotComponent`.

Remove the standalone `Root` provider and its DOM/render props. Return a client-bound `Provider` from `createTailorKitClient`, accepting only `children` and `apps`, with the client supplied internally. Export it as `Provider: TailorKitProvider` alongside the hooks and `RenderSlot`, and wrap host components in `<TailorKitProvider>`. Export `TailorKitProviderProps` for the bound provider.
