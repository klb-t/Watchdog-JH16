/** Bounded Atom reader. No DTD, external entities, HTML execution or network resolution.
 * A small XML subset is sufficient for arXiv's documented Atom feed. Unsupported
 * declarations fail visibly instead of being interpreted as an empty result set. */
type Node = { name: string; attrs: Record<string, string>; children: Node[]; text: string };
function entities(text: string): string {
  return text.replace(/&([^;]+);/g, (_, key: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, key)) return named[key];
    if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(key)) throw new Error('Unsupported XML entity');
    const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    if (!Number.isInteger(code) || code > 0x10ffff || code < 0x20 && ![9, 10, 13].includes(code) || code >= 0xd800 && code <= 0xdfff) throw new Error('Invalid XML character');
    return String.fromCodePoint(code);
  });
}
export function parseArxivAtom(xml: string) {
  if (xml.length > 5000000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported or oversized Atom document');
  const root: Node = { name: '#root', attrs: {}, children: [], text: '' }, stack = [root]; let at = 0, count = 0;
  while (at < xml.length) {
    const current = stack[stack.length - 1];
    if (xml[at] !== '<') {
      const end = xml.indexOf('<', at), stop = end < 0 ? xml.length : end;
      current.text += entities(xml.slice(at, stop)); at = stop; continue;
    }
    if (xml.startsWith('<!--', at) || xml.startsWith('<?', at) || xml.startsWith('<![CDATA[', at)) {
      const cdata = xml.startsWith('<![CDATA[', at), comment = xml.startsWith('<!--', at), ending = cdata ? ']]>' : comment ? '-->' : '?>';
      const end = xml.indexOf(ending, at + 2); if (end < 0) throw new Error('Unclosed XML section');
      if (cdata) current.text += xml.slice(at + 9, end);
      at = end + ending.length; continue;
    }
    let end = at + 1, quote = '';
    for (; end < xml.length; end++) {
      const c = xml[end]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
    }
    if (end >= xml.length) throw new Error('Unclosed XML tag');
    const raw = xml.slice(at + 1, end); at = end + 1;
    if (raw.startsWith('/')) { if (stack.length < 2 || stack.pop()!.name !== raw.slice(1).trim()) throw new Error('Mismatched XML tag'); continue; }
    const selfClosing = raw.endsWith('/'), tag = selfClosing ? raw.slice(0, -1) : raw;
    const name = /^[A-Za-z_][\w.:-]*/.exec(tag)?.[0]; if (!name) throw new Error('Unsupported XML declaration');
    const attrs: Record<string, string> = {}; let rest = tag.slice(name.length);
    while (rest.trim()) {
      const match = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
      if (!match || Object.hasOwn(attrs, match[1])) throw new Error('Invalid XML attribute');
      attrs[match[1]] = entities(match[2] ?? match[3]); rest = rest.slice(match[0].length);
    }
    const node: Node = { name, attrs, children: [], text: '' }; current.children.push(node);
    if (++count > 100000 || stack.length > 40) throw new Error('Atom structure limit exceeded');
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new Error('Invalid Atom root');
  const feed = root.children[0], local = (n: Node) => n.name.split(':').at(-1);
  if (local(feed) !== 'feed' || !Object.values(feed.attrs).includes('http://www.w3.org/2005/Atom')) throw new Error('Not an Atom feed');
  const child = (n: Node, key: string) => n.children.find(c => local(c) === key);
  const text = (n: Node, key: string) => child(n, key)?.text.trim().replace(/\s+/g, ' ') ?? '';
  const totalText = text(feed, 'totalResults'), total = Number(totalText); if (!/^\d+$/.test(totalText) || !Number.isSafeInteger(total) || total < 0) throw new Error('Missing Atom totalResults');
  const entries = feed.children.filter(n => local(n) === 'entry').map(n => {
    const id = text(n, 'id');
    if (!/^https?:\/\/arxiv\.org\/abs\/(?:[a-z-]+(?:\.[A-Z]{2})?\/)?[0-9.]+v\d+$/.test(id)) throw new Error('Invalid arXiv record identifier');
    return { sourceId: id.split('/abs/')[1], title: text(n, 'title'), abstract: text(n, 'summary'),
      authors: n.children.filter(c => local(c) === 'author').map(c => text(c, 'name')),
      doi: text(n, 'doi') || null, url: id.replace(/^http:/, 'https:'), publishedAt: text(n, 'published') || null,
      updatedAt: text(n, 'updated') || null, categories: n.children.filter(c => local(c) === 'category').map(c => c.attrs.term).filter(Boolean) };
  });
  return { total, entries };
}
