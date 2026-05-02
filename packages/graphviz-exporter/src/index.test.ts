import { describe, it, expect } from 'vitest';
import { parse, normalizeDocument, buildGraph } from '@pfdsl/core';
import { exportDot } from './index.js';

function buildFromSource(src: string) {
  const { document, frontmatter } = parse(src);
  const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
  const graph = buildGraph(edges, nodeKinds);
  return { graph, frontmatter };
}

describe('exportDot', () => {
  it('emits a digraph with default rankdir LR', () => {
    const { graph, frontmatter } = buildFromSource('req >> design -> spec\n');
    const dot = exportDot(graph, frontmatter);
    expect(dot.startsWith('digraph PFDSL {')).toBe(true);
    expect(dot).toContain('rankdir=LR;');
    expect(dot.endsWith('}\n')).toBe(true);
  });

  it('uses box for artifacts and ellipse for processes', () => {
    const { graph, frontmatter } = buildFromSource('req >> design -> spec\n');
    const dot = exportDot(graph, frontmatter);
    expect(dot).toMatch(/"req" \[shape=box, label="req"\]/);
    expect(dot).toMatch(/"design" \[shape=ellipse, label="design"\]/);
    expect(dot).toMatch(/"spec" \[shape=box, label="spec"\]/);
  });

  it('emits primary edges as solid arrows', () => {
    const { graph, frontmatter } = buildFromSource('req >> design -> spec\n');
    const dot = exportDot(graph, frontmatter);
    expect(dot).toContain('"req" -> "design";');
    expect(dot).toContain('"design" -> "spec";');
  });

  it('emits feedback edges as dashed with color', () => {
    const src = 'req >> design -> spec\nspec >>? design\n';
    const { graph, frontmatter } = buildFromSource(src);
    const dot = exportDot(graph, frontmatter);
    expect(dot).toMatch(/"spec" -> "design" \[style=dashed, color="#888888", constraint=false\];/);
  });

  it('uses frontmatter title for node label', () => {
    const src = `---
artifact:
  req: { title: 要求仕様書 }
process:
  design: { title: 設計 }
---
req >> design -> spec
`;
    const { graph, frontmatter } = buildFromSource(src);
    const dot = exportDot(graph, frontmatter);
    expect(dot).toContain('"req" [shape=box, label="req\\n要求仕様書"]');
    expect(dot).toContain('"design" [shape=ellipse, label="design\\n設計"]');
  });

  it('honors layout.direction in frontmatter', () => {
    const src = `---
layout: { direction: TB }
---
req >> design -> spec
`;
    const { graph, frontmatter } = buildFromSource(src);
    const dot = exportDot(graph, frontmatter);
    expect(dot).toContain('rankdir=TB;');
  });

  it('options override frontmatter direction', () => {
    const src = `---
layout: { direction: TB }
---
req >> design -> spec
`;
    const { graph, frontmatter } = buildFromSource(src);
    const dot = exportDot(graph, frontmatter, { rankdir: 'BT' });
    expect(dot).toContain('rankdir=BT;');
  });

  it('emits graph label from frontmatter title', () => {
    const src = `---
title: 開発フロー
---
req >> design -> spec
`;
    const { graph, frontmatter } = buildFromSource(src);
    const dot = exportDot(graph, frontmatter);
    expect(dot).toContain('label="開発フロー"');
    expect(dot).toContain('labelloc="t";');
  });

  it('escapes quotes and backslashes in IDs and labels', () => {
    const { graph, frontmatter } = buildFromSource('"a\\"b" >> P -> X\n');
    const dot = exportDot(graph, frontmatter);
    expect(dot).toContain('"a\\"b"');
  });
});
