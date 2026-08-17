---
name: Anthropic access
description: Why this project uses direct Anthropic SDK access for learner intelligence.
---

SLATE ALIS uses the direct Anthropic SDK with the project’s secure `ANTHROPIC_API_KEY` secret rather than Replit-managed Anthropic setup.

**Why:** The managed setup required an account upgrade, and the user chose to provide a securely stored project secret instead.

**How to apply:** Keep the key server-side only, use the existing AI helper, and do not expose it in frontend code or logs.