import { STOPWORDS, splitPassages, stem, tokenize } from '@/services/chat/demo/retrieval';
import type { DocumentText } from '@/services/chat/demo/textIndex';

/**
 * Builds the topic map from the document's real text with plain statistics. No model is involved:
 * a topic is a frequent term, a link means two terms share sentences, and every fragment is verbatim.
 */
export interface Fragment {
  page: number;
  quote: string;
}

export interface TopicNode {
  id: string;
  label: string;
  mentions: number;
  pages: number[];
  fragments: Fragment[];
  group: number;
}

export interface TopicEdge {
  source: string;
  target: string;
  /** Passages in which both terms appear. */
  weight: number;
}

export interface TopicGraph {
  nodes: TopicNode[];
  edges: TopicEdge[];
}

const MAX_NODES = 50;
const MAX_FRAGMENTS = 5;
const EDGES_PER_NODE = 4;
const GROUPS = 5;

/** Common words that are fine in a search query but say nothing as a topic. */
const NOT_TOPICS = new Set(
  `each within must shall have will other such both after before than then them they their more most only into over under
  also upon between during without however very being days
  должны должен должна может могут также более после перед между только однако через этих такие такой является являются
  немесе тиіс болып үшін бойынша арасында сондай және болуы мүмкін қажет алады береді`.split(/\s+/),
);

const isContent = (word: string) => word.length >= 4 && !STOPWORDS.has(word) && !NOT_TOPICS.has(word) && !/^\p{N}+$/u.test(word);

/** Keys of the terms in a text: single words, plus pairs of neighbouring content words. */
function termsOf(text: string): Array<{ key: string; surface: string }> {
  const words = tokenize(text);
  const terms: Array<{ key: string; surface: string }> = [];
  words.forEach((word, index) => {
    if (!isContent(word)) return;
    terms.push({ key: stem(word), surface: word });
    const next = words[index + 1];
    if (next && isContent(next)) terms.push({ key: `${stem(word)} ${stem(next)}`, surface: `${word} ${next}` });
  });
  return terms;
}

/** Lines repeated across pages (headers, footers, stamps) say nothing about the content. */
export function stripBoilerplate(pages: DocumentText): string[] {
  const normalize = (item: string) => item.replace(/\p{N}+/gu, '').trim();
  const seen = new Map<string, number>();
  if (pages.length >= 3) {
    for (const page of pages) {
      for (const line of new Set(page.items.map(normalize))) {
        if (line.length >= 8) seen.set(line, (seen.get(line) ?? 0) + 1);
      }
    }
  }
  const limit = Math.max(3, Math.ceil(pages.length / 2));
  return pages.map((page) =>
    page.items.reduce(
      (text, item) => ((seen.get(normalize(item)) ?? 0) >= limit && item.trim() ? text.replace(item.trim(), ' ') : text),
      page.text,
    ),
  );
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

function assignGroups(ids: string[], edges: TopicEdge[]): Map<string, number> {
  const labels = new Map(ids.map((id, index) => [id, index]));
  for (let round = 0; round < 8; round += 1) {
    for (const id of ids) {
      const votes = new Map<number, number>();
      for (const edge of edges) {
        const other = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
        if (other === null) continue;
        const label = labels.get(other) ?? 0;
        votes.set(label, (votes.get(label) ?? 0) + edge.weight);
      }
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (best) labels.set(id, best[0]);
    }
  }
  const sizes = new Map<number, number>();
  for (const label of labels.values()) sizes.set(label, (sizes.get(label) ?? 0) + 1);
  const order = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([label]) => label);
  return new Map(ids.map((id) => [id, order.indexOf(labels.get(id) ?? 0) % GROUPS]));
}

export function buildTopicGraph(pages: DocumentText): TopicGraph {
  const stats = new Map<string, { count: number; pages: Set<number>; surfaces: Map<string, number> }>();
  const cleaned = stripBoilerplate(pages);
  pages.forEach((page, index) => {
    for (const { key, surface } of termsOf(cleaned[index] ?? '')) {
      const entry = stats.get(key) ?? { count: 0, pages: new Set<number>(), surfaces: new Map<string, number>() };
      entry.count += 1;
      entry.pages.add(page.page);
      entry.surfaces.set(surface, (entry.surfaces.get(surface) ?? 0) + 1);
      stats.set(key, entry);
    }
  });

  const score = (key: string, count: number, onPages: number) => count * (key.includes(' ') ? 1.5 : 1) * (1 + Math.log(onPages));
  const ranked = [...stats.entries()]
    .filter(([, entry]) => entry.count >= 2)
    .sort((a, b) => score(b[0], b[1].count, b[1].pages.size) - score(a[0], a[1].count, a[1].pages.size) || a[0].localeCompare(b[0]))
    .slice(0, MAX_NODES * 2);
  const pairs = ranked.filter(([key]) => key.includes(' '));
  // "customer" adds nothing when nearly all its mentions are inside "customer data".
  const kept = ranked
    .filter(([key, entry]) => key.includes(' ') || !pairs.some(([pair, p]) => pair.split(' ').includes(key) && p.count >= entry.count * 0.8))
    .slice(0, MAX_NODES);
  const keys = new Set(kept.map(([key]) => key));

  const passagesOf = (texts: string[]) =>
    texts.flatMap((text, index) =>
      splitPassages(text).map((quote) => ({ page: pages[index]?.page ?? index + 1, quote, keys: new Set(termsOf(quote).map((t) => t.key).filter((k) => keys.has(k))) })),
    );

  const together = new Map<string, number>();
  for (const passage of passagesOf(cleaned)) {
    const present = [...passage.keys].sort();
    present.forEach((a, i) => {
      for (const b of present.slice(i + 1)) {
        // A pair and its own word always appear together, which is not a relation.
        if (a.split(' ').includes(b) || b.split(' ').includes(a)) continue;
        const id = `${a}|${b}`;
        together.set(id, (together.get(id) ?? 0) + 1);
      }
    });
  }
  const all = [...together.entries()].map(([id, weight]) => {
    const [source = '', target = ''] = id.split('|');
    return { source, target, weight };
  });
  const strong = all.filter((edge) => edge.weight >= 2);
  const usable = (strong.length >= kept.length / 2 ? strong : all).sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source));
  const perNode = new Map<string, number>();
  const edges = usable.filter((edge) => {
    const roomy = (perNode.get(edge.source) ?? 0) < EDGES_PER_NODE || (perNode.get(edge.target) ?? 0) < EDGES_PER_NODE;
    if (roomy) {
      perNode.set(edge.source, (perNode.get(edge.source) ?? 0) + 1);
      perNode.set(edge.target, (perNode.get(edge.target) ?? 0) + 1);
    }
    return roomy;
  });

  // Fragments come from the original text, so the quote can be found on the page exactly as written.
  const original = passagesOf(pages.map((page) => page.text));
  const ids = kept.map(([key]) => key).filter((key) => edges.length === 0 || perNode.has(key));
  const groups = assignGroups(ids, edges);
  const nodes = ids.flatMap((id): TopicNode[] => {
    const entry = stats.get(id);
    if (!entry) return [];
    const label = [...entry.surfaces.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? id;
    const matching = original.filter((passage) => passage.keys.has(id));
    const seenPages = new Set<number>();
    const firstOnPage = matching.filter((p) => !seenPages.has(p.page) && seenPages.add(p.page));
    const fragments = [...new Map([...firstOnPage, ...matching].map((p) => [p.quote, { page: p.page, quote: p.quote }])).values()].slice(0, MAX_FRAGMENTS);
    return [{ id, label: capitalize(label), mentions: entry.count, pages: [...entry.pages].sort((a, b) => a - b), fragments, group: groups.get(id) ?? 0 }];
  });
  const present = new Set(nodes.map((node) => node.id));
  return { nodes, edges: edges.filter((edge) => present.has(edge.source) && present.has(edge.target)) };
}

export function neighbours(graph: TopicGraph, id: string): Array<{ node: TopicNode; weight: number }> {
  return graph.edges
    .flatMap((edge) => {
      const other = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
      const node = other && graph.nodes.find((candidate) => candidate.id === other);
      return node ? [{ node, weight: edge.weight }] : [];
    })
    .sort((a, b) => b.weight - a.weight);
}

export function searchTopics(graph: TopicGraph, query: string): TopicNode[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? graph.nodes.filter((node) => node.label.toLocaleLowerCase().includes(needle)) : [];
}

/** The largest topic of each group of terms that share passages. The document's own node links to these. */
export function hubsOf(graph: TopicGraph): string[] {
  const best = new Map<number, TopicNode>();
  for (const node of graph.nodes) {
    const held = best.get(node.group);
    if (!held || node.mentions > held.mentions) best.set(node.group, node);
  }
  return [...best.values()].map((node) => node.id);
}

/** The topics to draw: the most mentioned, plus anything the user is looking at. Nothing else is lost, only not drawn. */
export function visibleTopics(graph: TopicGraph, limit: number, keep: Iterable<string>): Set<string> {
  const ranked = [...graph.nodes].sort((a, b) => b.mentions - a.mentions || a.id.localeCompare(b.id));
  return new Set([...ranked.slice(0, limit).map((node) => node.id), ...keep]);
}
