export const site = {
  title: 'AI Infra Notes',
  author: '黄彦凯',
  description: '我的 AI Infra 知识笔记、面试复盘与技术实践。',
};

export const sections = {
  knowledge: { label: '知识库', english: 'KNOWLEDGE', icon: 'book', description: '把常见问题讲清楚，也把背后的原理想明白。' },
  interviews: { label: '面试复盘', english: 'INTERVIEWS', icon: 'message', description: '记录问题、还原回答，把每次面试变成下一次的准备。' },
  articles: { label: '技术文章', english: 'WRITING', icon: 'file', description: '记录实现过程、实验观察和技术思考。' },
} as const;

export type Section = keyof typeof sections;
export const topics = {
  inference: { label: '推理系统', icon: 'layers', description: '调度、KV Cache、推理框架与性能优化。' },
  models: { label: '模型与深度学习', icon: 'nodes', description: 'Transformer、注意力机制与模型执行。' },
  systems: { label: '系统基础', icon: 'terminal', description: '内存、I/O、并发与计算机系统。' },
  programming: { label: '编程与算法', icon: 'code', description: '语言机制、数据结构与工程实现。' },
} as const;
export type Topic = keyof typeof topics;

export function url(path: string = '/') {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
