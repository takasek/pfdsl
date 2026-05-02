import { describe, it, expect } from 'vitest';
import { loadFrontmatter } from './frontmatter.js';

describe('loadFrontmatter', () => {
  it('no frontmatter: returns body as-is, bodyStartLine=1', () => {
    const result = loadFrontmatter('A >> P -> B\n');
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('A >> P -> B\n');
    expect(result.bodyStartLine).toBe(1);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('valid frontmatter: parses YAML and extracts body', () => {
    const src = '---\ntitle: Test\n---\nA >> P\n';
    const result = loadFrontmatter(src);
    expect(result.frontmatter).toEqual({ title: 'Test' });
    expect(result.body).toBe('A >> P\n');
    expect(result.bodyStartLine).toBe(4);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('empty frontmatter block: returns null frontmatter', () => {
    const src = '---\n---\nA >> P\n';
    const result = loadFrontmatter(src);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('A >> P\n');
    expect(result.bodyStartLine).toBe(3);
  });

  it('invalid YAML: returns error diagnostic and null frontmatter', () => {
    const src = '---\n: bad: yaml\n---\nbody\n';
    const result = loadFrontmatter(src);
    expect(result.frontmatter).toBeNull();
    expect(result.diagnostics.some(d => d.severity === 'error' && d.code === 'FM002')).toBe(true);
  });

  it('unclosed frontmatter: returns error and treats whole source as body', () => {
    const src = '---\ntitle: Test\n';
    const result = loadFrontmatter(src);
    expect(result.frontmatter).toBeNull();
    expect(result.diagnostics.some(d => d.code === 'FM001')).toBe(true);
  });

  it('bodyStartLine accounts for frontmatter line count', () => {
    const src = '---\na: 1\nb: 2\n---\nbody';
    const result = loadFrontmatter(src);
    expect(result.bodyStartLine).toBe(5);
  });

  it('parses status, tags, statusStyles, tagStyles', () => {
    const src = [
      '---',
      'artifact:',
      '  spec:',
      '    status: done',
      '    tags: [external, critical]',
      'statusStyles:',
      '  done: { fillcolor: lightgray, style: filled }',
      'tagStyles:',
      '  external: { color: blue }',
      '  critical: { penwidth: "3" }',
      '---',
      'spec >> P -> X',
      '',
    ].join('\n');
    const result = loadFrontmatter(src);
    expect(result.diagnostics).toHaveLength(0);
    const fm = result.frontmatter!;
    expect(fm.artifact?.spec?.status).toBe('done');
    expect(fm.artifact?.spec?.tags).toEqual(['external', 'critical']);
    expect(fm.statusStyles?.done?.fillcolor).toBe('lightgray');
    expect(fm.tagStyles?.external?.color).toBe('blue');
    expect(fm.tagStyles?.critical?.penwidth).toBe('3');
  });
});
