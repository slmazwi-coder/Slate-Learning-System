---
name: OpenAPI codegen and Zod 3
description: OpenAPI-to-Zod output must stay compatible with the workspace's current Zod 3 dependency.
---

When adding OpenAPI schemas, avoid `format: uuid`, `format: email`, and `type: integer` unless the code generator or Zod dependency has changed. The current generator emits `zod.uuid()`, `zod.email()`, and `zod.int()` for those forms, but this workspace's Zod 3 does not provide those helpers. Use plain string and number schemas, and validate formats in route code.

**Why:** Generated client builds failed on these helper calls when new contracts were added; `format: email` also emitted the unsupported Zod 4-only `.email()` helper.

**How to apply:** After changing the OpenAPI spec, run the api-spec codegen and typecheck. Revisit this constraint if the workspace upgrades Zod or generator templates.