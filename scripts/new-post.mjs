#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('usage: npm run new -- my-post-slug');
  console.error('slug must be lowercase-kebab-case');
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'blog');
const file = join(dir, `${slug}.md`);

mkdirSync(dir, { recursive: true });

if (existsSync(file)) {
  console.error(`already exists: src/content/blog/${slug}.md`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);

writeFileSync(
  file,
  `---
title: "${slug.replace(/-/g, ' ')}"
description: "TODO: one sentence for listings and RSS."
pubDate: ${date}
tags: []
draft: true
---

Write here.
`,
);

console.log(`created src/content/blog/${slug}.md (draft: true)`);
