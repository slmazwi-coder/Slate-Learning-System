---
name: GitHub push authentication
description: Runtime GitHub authentication needed to push this repository's main branch.
---

The configured HTTPS credential helper rejects pushes to `origin`. When a push is requested, authenticate Git at invocation time with the workspace's `GITHUB_TOKEN` secret; never print, persist, or commit the token.

**Why:** A regular push failed with an invalid-credential response, while using the existing workspace secret for the same push succeeded.

**How to apply:** Use only for an explicitly requested push. After pushing, verify that local `HEAD` matches `origin/main` and the working tree is clean.