import { describe, it, expect } from 'vitest';
import { parse, normalizeDocument, buildGraph } from '@pfdsl/core';
import { renderGraph, renderDotToSvg } from './index.js';

function buildFromSource(src: string) {
  const { document, frontmatter } = parse(src);
  const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
  const graph = buildGraph(edges, nodeKinds);
  return { graph, frontmatter };
}

describe('preview-engine', () => {
  it('renderGraph format=dot returns DOT', async () => {
    const { graph, frontmatter } = buildFromSource('req >> design -> spec\n');
    const out = await renderGraph(graph, frontmatter, { format: 'dot' });
    expect(out.startsWith('digraph PFDSL {')).toBe(true);
  });

  it('renderGraph default returns SVG', async () => {
    const { graph, frontmatter } = buildFromSource('req >> design -> spec\n');
    const svg = await renderGraph(graph, frontmatter);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renderDotToSvg renders raw DOT', async () => {
    const svg = await renderDotToSvg('digraph G { a -> b }');
    expect(svg).toContain('<svg');
  });
});
