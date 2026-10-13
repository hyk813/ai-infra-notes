export {};
type SearchEntry = { key: string; href: string; title: string; description: string; section: string; sectionLabel: string; category: string; tags: string[]; text: string };
const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const $$ = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];
const toast = (message: string) => {
  const element = $<HTMLElement>('.toast');
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  window.setTimeout(() => { element.hidden = true; }, 2200);
};

const themeToggle = $<HTMLButtonElement>('[data-theme-toggle]');
const updateThemeLabel = () => themeToggle?.setAttribute('aria-label', document.documentElement.dataset.theme === 'dark' ? '切换浅色模式' : '切换深色模式');
updateThemeLabel();
themeToggle?.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('ai-notes-theme', theme); } catch { /* Theme still works without storage. */ }
  updateThemeLabel();
});

$<HTMLButtonElement>('[data-mobile-menu]')?.addEventListener('click', (event) => {
  const open = $<HTMLElement>('#main-nav')?.classList.toggle('open');
  (event.currentTarget as HTMLButtonElement).setAttribute('aria-expanded', String(!!open));
});

// Search is local: the index is generated from Markdown, including article bodies.
const dialog = $<HTMLDialogElement>('#search-dialog');
const input = $<HTMLInputElement>('#global-search');
const results = $<HTMLUListElement>('#search-results');
const searchStatus = $<HTMLElement>('#search-status');
let indexPromise: Promise<SearchEntry[]> | undefined;
let scope = 'all';
let selected = -1;
let searchRevision = 0;
let lastFocus: HTMLElement | null = null;
const loadIndex = () => indexPromise ??= fetch(dialog!.dataset.searchIndex!).then((response) => {
  if (!response.ok) throw new Error('Search index unavailable');
  return response.json() as Promise<SearchEntry[]>;
}).catch((error) => { indexPromise = undefined; throw error; });
const selectResult = (position: number) => {
  const links = $$<HTMLAnchorElement>('.search-result');
  selected = links.length ? (position + links.length) % links.length : -1;
  links.forEach((link, i) => link.classList.toggle('selected', i === selected));
  links[selected]?.scrollIntoView({ block: 'nearest' });
};
async function search() {
  if (!input || !results || !searchStatus) return;
  const revision = ++searchRevision;
  const query = input.value.trim().toLocaleLowerCase();
  results.replaceChildren(); selected = -1;
  if (!query) { searchStatus.textContent = '输入关键词，搜索标题、标签和正文。'; return; }
  searchStatus.textContent = '正在搜索…';
  try {
    const entries = await loadIndex();
    if (revision !== searchRevision) return;
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = entries.filter((entry) => scope === 'all' || entry.section === scope).map((entry) => {
      const title = entry.title.toLocaleLowerCase();
      const tags = entry.tags.join(' ').toLocaleLowerCase();
      const description = entry.description.toLocaleLowerCase();
      const text = entry.text.toLocaleLowerCase();
      const haystack = `${title} ${tags} ${description} ${text}`;
      if (!terms.every((term) => haystack.includes(term))) return { entry, score: 0 };
      return { entry, score: terms.reduce((total, term) => total + 1 + (title.includes(term) ? 12 : 0) + (tags.includes(term) ? 5 : 0) + (description.includes(term) ? 3 : 0), 0) };
    }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
    searchStatus.textContent = matches.length ? `找到 ${matches.length} 篇内容` : '没有找到相关内容，试试更短的关键词。';
    for (const { entry } of matches.slice(0, 30)) {
      const li = document.createElement('li');
      const link = document.createElement('a'); link.className = 'search-result'; link.href = entry.href;
      const label = document.createElement('small'); label.textContent = `${entry.sectionLabel} · ${entry.category}`;
      const title = document.createElement('strong'); title.textContent = entry.title;
      const snippet = document.createElement('p');
      const firstHit = entry.text.toLocaleLowerCase().indexOf(terms[0]);
      const start = Math.max(0, firstHit - 30);
      snippet.textContent = `${start > 0 ? '…' : ''}${entry.text.slice(start, start + 130)}${entry.text.length > start + 130 ? '…' : ''}`;
      link.append(label, title, snippet); li.append(link); results.append(li);
    }
  } catch { if (revision === searchRevision) searchStatus.textContent = '搜索索引暂时无法加载，请确认本地服务正在运行后重试。'; }
}
const openSearch = () => {
  if (!dialog || !input || dialog.open) return;
  lastFocus = document.activeElement as HTMLElement;
  dialog.showModal(); input.focus(); void search();
};
$$<HTMLButtonElement>('[data-open-search]').forEach((button) => button.addEventListener('click', openSearch));
$<HTMLButtonElement>('[data-close-search]')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('close', () => lastFocus?.focus());
dialog?.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
input?.addEventListener('input', () => void search());
$$<HTMLButtonElement>('[data-search-scope]').forEach((button) => button.addEventListener('click', () => {
  scope = button.dataset.searchScope!;
  $$<HTMLButtonElement>('[data-search-scope]').forEach((item) => item.classList.toggle('selected', item === button));
  void search(); input?.focus();
}));
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') { event.preventDefault(); dialog?.open ? dialog.close() : openSearch(); }
  if (!dialog?.open) return;
  if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
  if (event.key === 'ArrowDown') { event.preventDefault(); selectResult(selected + 1); }
  if (event.key === 'ArrowUp') { event.preventDefault(); selectResult(selected - 1); }
  if (event.key === 'Enter' && event.target === input) { const links = $$<HTMLAnchorElement>('.search-result'); if (links.length) { event.preventDefault(); links[Math.max(selected, 0)].click(); } }
});
if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) $$<HTMLElement>('[data-shortcut]').forEach((element) => { element.textContent = 'Ctrl K'; });

const catalog = $<HTMLElement>('[data-catalog]');
if (catalog) {
  const textInput = $<HTMLInputElement>('[data-filter-text]')!;
  const tagInput = $<HTMLSelectElement>('[data-filter-tag]')!;
  const companyInput = $<HTMLSelectElement>('[data-filter-company]');
  const cards = [...catalog.querySelectorAll<HTMLElement>('[data-document-card]')];
  let topic = 'all';
  const filter = (pushUrl = true) => {
    const query = textInput.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const card of cards) {
      const tags = JSON.parse(card.dataset.tags || '[]') as string[];
      const matches = (topic === 'all' || card.dataset.category === topic) && (tagInput.value === 'all' || tags.includes(tagInput.value)) && (!companyInput || companyInput.value === 'all' || card.dataset.company === companyInput.value) && `${card.dataset.title} ${card.dataset.description} ${card.dataset.company} ${tags.join(' ')}`.toLocaleLowerCase().includes(query);
      card.hidden = !matches; if (matches) count++;
    }
    $$<HTMLButtonElement>('[data-topic]').forEach((button) => button.classList.toggle('active', button.dataset.topic === topic));
    $<HTMLElement>('[data-filter-count]')!.textContent = `显示 ${count} / ${cards.length} 篇 · 按更新时间排列`;
    $<HTMLElement>('[data-filter-empty]')!.hidden = count > 0;
    if (pushUrl) {
      const next = new URL(location.href);
      for (const [key, value] of [['topic', topic], ['tag', tagInput.value], ['q', textInput.value]]) value && value !== 'all' ? next.searchParams.set(key, value) : next.searchParams.delete(key);
      if (companyInput?.value && companyInput.value !== 'all') next.searchParams.set('company', companyInput.value); else next.searchParams.delete('company');
      history.replaceState({}, '', next);
    }
  };
  const hydrate = () => {
    const params = new URL(location.href).searchParams;
    const candidate = params.get('topic') || 'all';
    topic = $$<HTMLButtonElement>('[data-topic]').some((button) => button.dataset.topic === candidate) ? candidate : 'all';
    tagInput.value = [...tagInput.options].some((option) => option.value === params.get('tag')) ? params.get('tag')! : 'all';
    textInput.value = params.get('q') || ''; filter(false);
    if (companyInput) { companyInput.value = [...companyInput.options].some((option) => option.value === params.get('company')) ? params.get('company')! : 'all'; filter(false); }
  };
  $$<HTMLButtonElement>('[data-topic]').forEach((button) => button.addEventListener('click', () => { topic = button.dataset.topic!; filter(); }));
  textInput.addEventListener('input', () => filter()); tagInput.addEventListener('change', () => filter());
  companyInput?.addEventListener('change', () => filter());
  $<HTMLButtonElement>('[data-reset-filters]')?.addEventListener('click', () => { topic = 'all'; textInput.value = ''; tagInput.value = 'all'; if (companyInput) companyInput.value = 'all'; filter(); });
  window.addEventListener('popstate', hydrate); hydrate();
}

function bookmarks(): Set<string> {
  try { const data: unknown = JSON.parse(localStorage.getItem('ai-notes-bookmarks') || '[]'); return new Set(Array.isArray(data) ? data.filter((value): value is string => typeof value === 'string') : []); } catch { return new Set(); }
}
const updateBookmarks = () => {
  const saved = bookmarks();
  $$<HTMLButtonElement>('[data-bookmark]').forEach((button) => {
    const active = saved.has(button.dataset.bookmark!); button.classList.toggle('saved', active); button.setAttribute('aria-pressed', String(active));
    const label = button.querySelector('[data-bookmark-label]'); if (label) label.textContent = active ? '已收藏' : '收藏';
  });
  const list = $<HTMLElement>('[data-bookmarks-list]');
  if (list) {
    let count = 0;
    [...list.querySelectorAll<HTMLElement>('[data-document-card]')].forEach((card) => { const active = saved.has(card.dataset.documentKey!); card.hidden = !active; if (active) count++; });
    $<HTMLElement>('[data-bookmarks-empty]')!.hidden = count > 0;
    $<HTMLElement>('[data-bookmarks-count]')!.textContent = `共 ${count} 篇收藏`;
  }
};
$$<HTMLButtonElement>('[data-bookmark]').forEach((button) => button.addEventListener('click', () => {
  const saved = bookmarks(); const key = button.dataset.bookmark!;
  saved.has(key) ? saved.delete(key) : saved.add(key);
  try { localStorage.setItem('ai-notes-bookmarks', JSON.stringify([...saved])); updateBookmarks(); toast(saved.has(key) ? '已加入收藏' : '已取消收藏'); } catch { toast('浏览器存储不可用，收藏未保存'); }
}));
window.addEventListener('storage', updateBookmarks); updateBookmarks();

$$<HTMLPreElement>('.prose pre').forEach((pre) => {
  const code = pre.querySelector('code'); if (!code) return;
  const button = document.createElement('button'); button.className = 'copy-code'; button.type = 'button'; button.textContent = '复制'; button.setAttribute('aria-label', '复制代码'); pre.append(button);
  button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(code.textContent || ''); button.textContent = '已复制'; window.setTimeout(() => { button.textContent = '复制'; }, 1800); } catch { toast('无法访问剪贴板，请选中代码手动复制'); } });
});

const tocLinks = $$<HTMLAnchorElement>('[data-toc-link]');
if (tocLinks.length) {
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (!visible.length) return;
    tocLinks.forEach((link) => link.classList.toggle('active', link.dataset.tocLink === visible[0].target.id));
  }, { rootMargin: '-100px 0px -65% 0px', threshold: 0 });
  tocLinks.forEach((link) => { const heading = document.getElementById(link.dataset.tocLink!); if (heading) observer.observe(heading); });
}
const reading = $<HTMLElement>('[data-reading-content]');
if (reading) {
  const updateProgress = () => {
    const start = reading.getBoundingClientRect().top + window.scrollY - 100;
    const total = Math.max(1, reading.offsetHeight - window.innerHeight + 100);
    const progress = Math.min(100, Math.max(0, (window.scrollY - start) / total * 100));
    const bar = $<HTMLElement>('.reading-progress span'); if (bar) bar.style.width = `${progress}%`;
  };
  window.addEventListener('scroll', updateProgress, { passive: true }); window.addEventListener('resize', updateProgress); updateProgress();
}
