import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const [kind, title, ...rest] = args;
const kinds = { knowledge: 'knowledge', interviews: 'interview', articles: 'article' };
const help = `用法：npm run new -- <knowledge|interviews|articles> "标题" [--category inference] [--slug file-name]\n方向：inference（推理优化）、training（训练优化）、models（LLM 架构与算法）、fundamentals（系统基础）\n示例：npm run new -- knowledge "KV Cache 容量计算" --slug kv-cache-size`;
if (args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }
if (!Object.hasOwn(kinds, kind || '') || !title || title.startsWith('--')) { console.error(help); process.exit(1); }
const options = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!['--category', '--slug'].includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--')) { console.error(`无效参数：${rest[i]}\n${help}`); process.exit(1); }
  options[rest[i].slice(2)] = rest[i + 1];
}
const category = options.category || (kind === 'interviews' ? 'fundamentals' : 'inference');
if (!['inference', 'training', 'models', 'fundamentals'].includes(category)) { console.error('category 必须为 inference、training、models 或 fundamentals'); process.exit(1); }
const slug = options.slug || title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
if (!/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(slug)) { console.error('slug 只能包含文字、数字与连字符，不能包含目录路径'); process.exit(1); }
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const template = await fs.readFile(path.join(root, 'templates', `${kinds[kind]}.md`), 'utf8');
const contents = template.replaceAll('{{title}}', JSON.stringify(title)).replaceAll('{{date}}', date).replaceAll('{{category}}', category);
const target = path.join(root, 'content', kind, `${slug}.md`);
try {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, { flag: 'wx' });
  console.log(`已创建：${path.relative(root, target)}\n开发模式会显示草稿。整理好后将 draft 改为 false，再构建收录。`);
} catch (error) {
  if (error.code === 'EEXIST') { console.error(`文件已存在，未覆盖：${path.relative(root, target)}`); process.exitCode = 1; }
  else throw error;
}
