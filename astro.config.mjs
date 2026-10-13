import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import contentLinks from './scripts/remark-content-links.mjs';
import { unified } from '@astrojs/markdown-remark';

export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || undefined,
  base: process.env.SITE_BASE || '/',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath, [contentLinks, { base: process.env.SITE_BASE || '/', version: process.env.PUBLIC_SITE_VERSION || '' }]],
      rehypePlugins: [rehypeKatex],
    }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
  server: { port: 4321, host: '127.0.0.1' },
  vite: {
    server: {
      watch: { usePolling: true, interval: 500, ignored: ['**/work/**', '**/output/**', '**/.npm-cache/**'] },
    },
  },
});
