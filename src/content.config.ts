import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const schema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.enum(['inference', 'training', 'models', 'fundamentals']),
  tags: z.array(z.string()).default([]),
  date: z.coerce.date(),
  updated: z.coerce.date().optional(),
  order: z.number().default(100),
  draft: z.boolean().default(false),
  status: z.enum(['ready', 'review']).default('ready'),
  isExample: z.boolean().default(false),
  company: z.string().optional(),
  role: z.string().optional(),
  round: z.string().optional(),
});

const collection = (name: string) => defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: `./content/${name}`,
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema,
});

export const collections = {
  knowledge: collection('knowledge'),
  interviews: collection('interviews'),
  articles: collection('articles'),
};
