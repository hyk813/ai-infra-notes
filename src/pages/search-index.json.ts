import type { APIRoute } from 'astro';
import { documents, docUrl } from '../lib/content';
import { sections, topics } from '../config';

export const GET: APIRoute = async () => {
  const all = await documents();
  return new Response(JSON.stringify(all.map((entry) => ({
    key: `${entry.collection}:${entry.id}`,
    href: docUrl(entry), title: entry.data.title, description: entry.data.description,
    section: entry.collection, sectionLabel: sections[entry.collection].label,
    category: topics[entry.data.category].label, tags: entry.data.tags,
    text: (entry.body ?? '').replace(/```[^\n]*\n/g, '').replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim(),
  }))), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
