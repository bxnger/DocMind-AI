import { describe, expect, it } from 'vitest';
import type { DocumentText } from '@/services/chat/demo/textIndex';
import { buildTopicGraph, neighbours, searchTopics, stripBoilerplate } from './buildGraph';
import { WORLD, centerOn, fitView, layoutGraph, zoomAt } from './layout';

const page = (n: number, text: string, footer = 'Confidential company handbook') => ({
  page: n,
  items: [text, footer],
  text: `${text} ${footer}`,
});
const doc: DocumentText = [
  page(1, 'Invoice payment is due within thirty days. Late invoice payment accrues interest monthly.'),
  page(2, 'Vehicle tracking uses satellite signals. Vehicle tracking reports reach the dashboard daily.'),
  page(3, 'Invoice payment problems stop vehicle tracking access. Dashboard access requires invoice payment.'),
];

describe('buildTopicGraph', () => {
  const graph = buildTopicGraph(doc);
  const find = (label: string) => graph.nodes.find((n) => n.label.toLowerCase() === label);

  it('builds topics from terms that repeat in the document', () => {
    expect(find('invoice payment')?.mentions).toBe(4);
    expect(find('vehicle tracking')?.pages).toEqual([2, 3]);
  });

  it('every fragment is verbatim text of its stated page', () => {
    expect(graph.nodes.length).toBeGreaterThan(0);
    for (const node of graph.nodes) {
      expect(node.fragments.length).toBeGreaterThan(0);
      for (const fragment of node.fragments) expect(doc[fragment.page - 1]?.text).toContain(fragment.quote);
    }
  });

  it('links terms that share a passage and points at real nodes', () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
    const payment = find('invoice payment');
    expect(payment && neighbours(graph, payment.id).map((n) => n.node.label.toLowerCase())).toContain('vehicle tracking');
  });

  it('ignores footers repeated across pages', () => {
    expect(stripBoilerplate(doc)[0]).not.toContain('Confidential');
    expect(graph.nodes.some((n) => /confidential|handbook/i.test(n.label))).toBe(false);
  });

  it('does not treat a short document line as boilerplate on one or two pages', () => {
    expect(stripBoilerplate(doc.slice(0, 2))[0]).toContain('Confidential');
  });

  it('gives an empty graph when there is no text, such as a scan', () => {
    expect(buildTopicGraph([{ page: 1, items: [], text: '' }])).toEqual({ nodes: [], edges: [] });
  });

  it('works on Russian and Kazakh and keeps stopwords out', () => {
    const cyr = buildTopicGraph([
      { page: 1, items: [], text: 'Команда қатысушылары жобаны ұсынады туралы. Команда қатысушылары финалға өтеді туралы.' },
    ]);
    expect(cyr.nodes.map((n) => n.label)).toContain('Команда қатысушылары');
    expect(cyr.nodes.some((n) => n.label.toLowerCase() === 'туралы')).toBe(false);
  });

  it('does not present function words as topics', () => {
    const noisy = buildTopicGraph([{ page: 1, items: [], text: 'Each member must sign within time. Each member must pay within time. Қатысушы немесе команда тиіс. Қатысушы немесе команда тиіс.' }]);
    const labels = noisy.nodes.map((n) => n.label.toLowerCase());
    for (const word of ['each', 'must', 'within', 'немесе', 'тиіс']) expect(labels).not.toContain(word);
    expect(labels).toContain('member');
  });

  it('is deterministic and limited in size', () => {
    expect(buildTopicGraph(doc)).toEqual(graph);
    const words = Array.from({ length: 80 }, (_, i) => `term${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (i >> 2))}`);
    const big = buildTopicGraph([{ page: 1, items: [], text: `${words.join(' ')}. ${words.join(' ')}.` }]);
    expect(big.nodes.length).toBeLessThanOrEqual(30);
  });
});

describe('searchTopics', () => {
  const graph = buildTopicGraph(doc);
  it('matches labels regardless of case', () => {
    expect(searchTopics(graph, 'VEHICLE').length).toBeGreaterThan(0);
    expect(searchTopics(graph, 'absentword')).toEqual([]);
    expect(searchTopics(graph, '  ')).toEqual([]);
  });
});

describe('layout', () => {
  const graph = buildTopicGraph(doc);
  it('is repeatable and stays inside the world', () => {
    const a = layoutGraph(graph);
    expect([...a]).toEqual([...layoutGraph(graph)]);
    for (const point of a.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(WORLD.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(WORLD.height);
    }
  });

  it('does not stack nodes on each other', () => {
    const points = [...layoutGraph(graph).values()];
    points.forEach((a, i) => {
      for (const b of points.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(20);
    });
  });
});

describe('zoom and pan', () => {
  it('keeps the point under the cursor in place', () => {
    const view = { x: 10, y: 20, k: 1 };
    const next = zoomAt(view, 2, 300, 200);
    expect(next.x + ((300 - view.x) / view.k) * next.k).toBeCloseTo(300);
    expect(next.y + ((200 - view.y) / view.k) * next.k).toBeCloseTo(200);
  });
  it('clamps the zoom', () => {
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 100, 0, 0).k).toBe(4);
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 0.001, 0, 0).k).toBe(0.3);
  });
  it('fits the world and centres on a point', () => {
    expect(fitView(500, 350).k).toBeCloseTo(0.5);
    const c = centerOn({ x: 0, y: 0, k: 2 }, { x: 100, y: 50 }, 800, 600);
    expect(c.x + 100 * 2).toBe(400);
    expect(c.y + 50 * 2).toBe(300);
  });
});
