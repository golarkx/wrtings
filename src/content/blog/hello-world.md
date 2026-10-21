---
title: "Hello, world: how this site works"
description: "Why I moved my writing to markdown files, a static generator, and Cloudflare."
pubDate: 2026-10-12
tags: ["meta"]
---

I've started and abandoned more blogs than I'd like to admit. The usual failure
mode: a database, a CMS, an admin panel — and zero posts, because writing felt
like operating software instead of *writing*.

This site removes every step between having an idea and publishing it.

## The setup

- Posts are markdown files in `src/content/blog/`.
- [Astro](https://astro.build) renders them to static HTML at build time.
- Cloudflare Pages hosts the output on its global edge network.

There is no database, no runtime, and nothing to patch at 3am.

## Writing a post

Create a file, fill in the frontmatter, write:

```bash
npm run new -- my-first-post
```

The frontmatter is deliberately tiny:

```yaml
---
title: "My first post"
description: "One sentence for listings and RSS."
pubDate: 2026-10-12
tags: ["drafting"]
---
```

Then `git push`, and Cloudflare rebuilds the site. Total time from push to live:
about 30 seconds.

## What I gave up (on purpose)

No comments section, no analytics beacon, no cookie banner. If you want to
respond, [email me](mailto:you@example.com) or find me on social links in the
footer of the home page.

> Constraints are features. A blog that only does writing is a blog that gets
> written.
