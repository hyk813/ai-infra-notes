export const site = {
  title: 'AI Infra Notes',
  author: '黄彦凯',
  description: '我的 AI Infra 知识笔记、面经总结与技术实践。',
};

export const sections = {
  knowledge: { label: '知识库', english: 'KNOWLEDGE', icon: 'book', description: '把常见问题讲清楚，也把背后的原理想明白。' },
  interviews: { label: '面经总结', english: 'INTERVIEWS', icon: 'message', description: '整理面试问题、回答与经验，明确下一次准备的重点。' },
  articles: { label: '技术文章', english: 'WRITING', icon: 'file', description: '记录实现过程、实验观察和技术思考。' },
} as const;

export type Section = keyof typeof sections;
export const topics = {
  inference: { label: '推理优化', icon: 'layers', description: '调度、KV Cache、推理框架与性能优化。' },
  training: { label: '训练优化', icon: 'training', description: '分布式训练、显存管理与训练性能优化。' },
  models: { label: 'LLM 架构与算法', icon: 'nodes', description: 'Transformer、注意力机制、MoE 与模型算法。' },
  fundamentals: { label: '计算机基础', icon: 'terminal', description: '操作系统、网络、编程语言与数据结构。' },
} as const;
export type Topic = keyof typeof topics;

export const siteVersion = import.meta.env.PUBLIC_SITE_VERSION || '';

export function pathUrl(path: string = '/') {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function url(path: string = '/') {
  const result = pathUrl(path);
  if (!siteVersion) return result;
  const target = new URL(result, 'https://site.invalid');
  target.searchParams.set('v', siteVersion);
  return `${target.pathname}${target.search}${target.hash}`;
}
