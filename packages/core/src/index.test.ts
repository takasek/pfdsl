import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, normalizeDocument, validateGraph, format } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(__dirname, '../../../docs/pfdsl_implementation_flow.pfdsl');
const sampleSource = readFileSync(samplePath, 'utf-8');

describe('public API', () => {
  it('parse: parses the sample .pfdsl file without syntax errors', () => {
    const result = parse(sampleSource);
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.document.statements.length).toBeGreaterThan(0);
    expect(result.frontmatter).not.toBeNull();
  });

  it('normalizeDocument: produces edges without type errors', () => {
    const { document, frontmatter } = parse(sampleSource);
    const { edges, diagnostics } = normalizeDocument(document, frontmatter);
    const errors = diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(edges.length).toBeGreaterThan(0);
  });

  it('validateGraph: sample file passes validation', () => {
    const { document, frontmatter } = parse(sampleSource);
    const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
    const diags = validateGraph(edges, nodeKinds, frontmatter);
    const errors = diags.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('format: matches golden canonical output for sample file (locks spec §14 ordering)', () => {
    const { output, diagnostics } = format(sampleSource);
    const errors = diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(output).toMatchSnapshot();
  });

  it('format is idempotent (format of format = format)', () => {
    const { output: first } = format(sampleSource);
    const { output: second } = format(first);
    expect(second).toBe(first);
  });
});
