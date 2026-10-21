# ~/ writings

A terminal-styled personal blog built with [Astro](https://astro.build), hosted
on [Cloudflare Pages](https://pages.cloudflare.com).

## Commands

```bash
npm install
npm run dev            # local dev server
npm run build          # static output in dist/
npm run preview        # preview the production build
npm run new -- my-post # scaffold src/content/blog/my-post.md (draft)
```

## Writing

Posts live in `src/content/blog/*.md`. Frontmatter:

```yaml
---
title: "Post title"
description: "One sentence, used in listings and links."
pubDate: 2026-10-20
updatedDate: 2026-10-21   # optional
tags: ["notes"]           # optional
draft: true               # optional; draft posts are excluded from the build
---
```

## Deploy on Cloudflare Pages

1. Push this repo to GitHub/GitLab.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Output directory: `dist`
4. Set your domain under **Custom domains** (TLS is automatic).

Every `git push` to `main` rebuilds and deploys in ~30 seconds.

> Before deploying, update `site` in `astro.config.mjs` to your real domain.

## Structure

```
src/
  content/blog/        # your markdown posts
  layouts/BaseLayout.astro
  components/          # header, footer, animated canvas background
  pages/index.astro    # home
  pages/blog/          # post list + [slug] article pages
  styles/global.css
public/                # favicon, _headers, _redirects
```
