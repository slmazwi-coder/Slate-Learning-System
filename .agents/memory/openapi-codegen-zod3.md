---
name: OpenAPI codegen and Zod 3
description: OpenAPI-to-Zod output must stay compatible with the workspace's current Zod 3 dependency.
---

When adding OpenAPI schemas, avoid `format: uuid` and `type: integer` unless the code generator or Zod dependency has changed. The current generator emits `zod.uuid()` and `zod.int()` for those forms, but this workspace's Zod 3 does not provide those helpers. Use plain string and number schemas for generated contracts.

**Why:** A generated client build failed on these helper calls when new teacher-assignment contracts were added.

**How to apply:** After changing the OpenAPI spec, run the api-spec codegen and typecheck. Revisit this constraint if the workspace upgrades Zod or generator templates.