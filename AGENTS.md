# Project instructions

- This repository is a local-first Astro + Markdown personal knowledge site.
- Keep knowledge, interviews, and articles in their existing `content/` collections.
- Preserve the user's content and frontmatter. Do not invent interview experiences or measured performance values.
- Use `isExample: true` for simulated interviews or experiment-writing examples.
- Put scratch files, fixture documents, and analysis under ignored `work/`; browser artifacts under ignored `output/playwright/`.
- Use `npm run check` and `npm run build` after functional changes. Use focused local UI checks for search, filtering, bookmarks, and responsive changes; do not access external accounts for tests.
- Keep assets and browsing features local; avoid remote fonts, CDN dependencies, or analytics.
- Keep `package-lock.json` and pinned framework versions. Use the project's npm cache configuration rather than changing global npm settings.
- Do not push or deploy without a user request. Treat this nested repository independently of its parent repository.
