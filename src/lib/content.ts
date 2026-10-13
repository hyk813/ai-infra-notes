import { getCollection, type CollectionEntry } from 'astro:content';
import { url, type Section } from '../config';

export type Document = CollectionEntry<Section>;

export async function documents(): Promise<Document[]> {
  const groups = await Promise.all([
    getCollection('knowledge'), getCollection('interviews'), getCollection('articles'),
  ]);
  return groups.flat().filter((entry) => import.meta.env.DEV || !entry.data.draft);
}

export function docUrl(entry: Document) {
  return url(`/${entry.collection}/${entry.id.split('/').map(encodeURIComponent).join('/')}/`);
}

export function updated(entry: Document) {
  return entry.data.updated ?? entry.data.date;
}

export function dateLabel(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date).replaceAll('/', '.');
}

export function readingMinutes(entry: Document) {
  return Math.max(1, Math.ceil((entry.body?.length ?? 0) / 650));
}

export function stateLabel(entry: Document) {
  return entry.data.draft ? '草稿' : entry.data.isExample ? '示例' : entry.data.status === 'review' ? '待复习' : '已整理';
}

export function recent(entries: Document[]) {
  return [...entries].sort((a, b) => updated(b).getTime() - updated(a).getTime() || a.data.order - b.data.order);
}
