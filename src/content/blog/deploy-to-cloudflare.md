---
title: "Deploying an Astro blog to Cloudflare Pages"
description: "Build command, output directory, custom domain — the whole path from repo to edge."
pubDate: 2026-10-18
tags: ["astro", "cloudflare", "tutorial"]
updatedDate: 2026-10-20
---

Astro produces static HTML by default, which makes Cloudflare Pages the
path of least resistance: no adapter, no serverless functions, no cold starts.

## 1. Push your repo

Any Git provider connected to Cloudflare works (GitHub, GitLab). From the
Cloudflare dashboard:

**Workers & Pages → Create → Pages → Connect to Git**

## 2. Set the build settings

| Setting        | Value         |
| -------------- | ------------- |
| Framework      | Astro         |
| Build command  | `npm run build` |
| Output directory | `dist`      |

Cloudflare auto-detects Astro, so you often only need to confirm.

## 3. Custom domain

Under **Custom domains**, add your domain and follow the CNAME/dns
instructions. TLS certificates are provisioned automatically — the one thing
Cloudflare genuinely gets for free.

## 4. Headers

Astro doesn't manage response headers, but Pages reads a `_headers` file from
your `public/` directory:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

## 5. Redirects (optional)

A `_redirects` file in `public/` works the same way:

```
/archive/*  /blog/:splat  301
```

## Local preview

```bash
npm run build
npm run preview
```

That's the whole path: `git push` → build at the edge → live in ~30 seconds.
