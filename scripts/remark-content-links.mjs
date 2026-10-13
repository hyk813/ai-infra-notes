import path from 'node:path';

export default function contentLinks(options = {}) {
  const base = (options.base || '/').replace(/\/$/, '');
  const root = path.resolve('content');
  return (tree, file) => {
    const source = file.path || file.history?.[0];
    if (!source) return;
    const walk = (node) => {
      if (node.type === 'link' && typeof node.url === 'string' && /\.md(?:[?#]|$)/.test(node.url) && !/^\w+:/.test(node.url)) {
        const [filename, suffix = ''] = node.url.split(/(?=[?#])/);
        const absolute = filename.startsWith('/') ? path.resolve(root, filename.slice(1)) : path.resolve(path.dirname(source), filename);
        const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
        if (/^(knowledge|interviews|articles)\//.test(relative)) {
          node.url = `${base}/${relative.replace(/\.md$/, '').split('/').map(encodeURIComponent).join('/')}/${suffix}`;
        }
      }
      for (const child of node.children || []) walk(child);
    };
    walk(tree);
  };
}
