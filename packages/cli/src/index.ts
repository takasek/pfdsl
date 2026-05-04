import { readFileSync, writeFileSync } from 'node:fs';
import {
  analyze,
  sortEdges,
  formatEdges,
  format,
  type Diagnostic,
} from '@pfdsl/core';
import { renderGraph } from '@pfdsl/preview-engine';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function ok(stdout = '', stderr = ''): CommandResult {
  return { stdout, stderr, exitCode: 0 };
}
function fail(stderr: string, exitCode = 1, stdout = ''): CommandResult {
  return { stdout, stderr, exitCode };
}

function formatDiagnostic(d: Diagnostic, file: string): string {
  const r = d.range;
  const loc = r ? `${file}:${r.start.line}:${r.start.column}` : file;
  return `${loc}: ${d.severity}: ${d.message}`;
}

function readSource(file: string): string {
  return readFileSync(file, 'utf-8');
}

function diagText(diags: Diagnostic[], file: string): string {
  return diags.map(d => formatDiagnostic(d, file)).join('\n') + '\n';
}

function failIfErrors(diags: Diagnostic[], file: string): CommandResult | null {
  const errs = diags.filter(d => d.severity === 'error');
  return errs.length > 0 ? fail(diagText(errs, file)) : null;
}

export function runCheck(file: string): CommandResult {
  const { diagnostics } = analyze(readSource(file));
  const lines = diagnostics.map(d => formatDiagnostic(d, file));
  const hasErr = diagnostics.some(d => d.severity === 'error');
  if (hasErr) {
    return { stdout: '', stderr: lines.join('\n') + '\n', exitCode: 1 };
  }
  return { stdout: lines.length ? lines.join('\n') + '\n' : 'OK\n', stderr: '', exitCode: 0 };
}

export interface FmtOptions { write?: boolean }
export function runFmt(file: string, opts: FmtOptions = {}): CommandResult {
  const source = readSource(file);
  const { output, diagnostics } = format(source);
  const failed = failIfErrors(diagnostics, file);
  if (failed) return failed;
  if (opts.write) {
    writeFileSync(file, output, 'utf-8');
    return ok();
  }
  return ok(output);
}

export function runNormalize(file: string): CommandResult {
  const { edges, graph, diagnostics } = analyze(readSource(file));
  const failed = failIfErrors(diagnostics, file);
  if (failed) return failed;
  return ok(formatEdges(sortEdges(edges, graph)));
}

export interface GraphOptions { format?: 'dot' | 'svg' }
export async function runGraph(file: string, opts: GraphOptions = {}): Promise<CommandResult> {
  const fmt = opts.format ?? 'dot';
  const { graph, frontmatter, diagnostics } = analyze(readSource(file));
  const failed = failIfErrors(diagnostics, file);
  if (failed) return failed;
  const out = await renderGraph(graph, frontmatter, { format: fmt });
  return ok(out.endsWith('\n') ? out : out + '\n');
}

export interface DiffReport {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  addedFeedback: string[];
  removedFeedback: string[];
}

function loadGraph(file: string) {
  return analyze(readSource(file)).graph;
}

function edgeKey(from: string, to: string): string {
  return `${from} -> ${to}`;
}

export function diffGraphs(fileA: string, fileB: string): DiffReport {
  const a = loadGraph(fileA);
  const b = loadGraph(fileB);
  const aNodes = new Set(a.nodes.keys());
  const bNodes = new Set(b.nodes.keys());
  const aEdges = new Set(a.primaryEdges.map(e => edgeKey(e.from, e.to)));
  const bEdges = new Set(b.primaryEdges.map(e => edgeKey(e.from, e.to)));
  const aFb = new Set(a.feedbackEdges.map(e => edgeKey(e.artifact, e.process)));
  const bFb = new Set(b.feedbackEdges.map(e => edgeKey(e.artifact, e.process)));

  const diff = (lhs: Set<string>, rhs: Set<string>) => [...rhs].filter(x => !lhs.has(x)).sort();

  return {
    addedNodes: diff(aNodes, bNodes),
    removedNodes: diff(bNodes, aNodes),
    addedEdges: diff(aEdges, bEdges),
    removedEdges: diff(bEdges, aEdges),
    addedFeedback: diff(aFb, bFb),
    removedFeedback: diff(bFb, aFb),
  };
}

export function runDiff(fileA: string, fileB: string): CommandResult {
  const r = diffGraphs(fileA, fileB);
  const out: string[] = [];
  const section = (label: string, items: string[]) => {
    for (const i of items) out.push(`${label} ${i}`);
  };
  section('+ node', r.addedNodes);
  section('- node', r.removedNodes);
  section('+ edge', r.addedEdges);
  section('- edge', r.removedEdges);
  section('+ feedback', r.addedFeedback);
  section('- feedback', r.removedFeedback);
  if (out.length === 0) return ok('no structural differences\n');
  return ok(out.join('\n') + '\n');
}

export const HELP = `pfdsl <command> [options]

Commands:
  check <file>             Validate a .pfdsl file
  fmt <file> [--write]     Format a .pfdsl file (prints to stdout, or rewrites with --write)
  normalize <file>         Print canonical edge list
  graph <file> [--format dot|svg]
                           Print Graphviz DOT (default) or SVG
  diff <a> <b>             Print structural diff between two files
  help                     Show this help
`;

export interface CliArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

export async function run(argv: readonly string[]): Promise<CommandResult> {
  const { command, positional, flags } = parseArgs(argv);
  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      return ok(HELP);
    case 'check': {
      const f = positional[0];
      if (!f) return fail('usage: pfdsl check <file>\n', 2);
      return runCheck(f);
    }
    case 'fmt': {
      const f = positional[0];
      if (!f) return fail('usage: pfdsl fmt <file> [--write]\n', 2);
      return runFmt(f, { write: flags.write === true });
    }
    case 'normalize': {
      const f = positional[0];
      if (!f) return fail('usage: pfdsl normalize <file>\n', 2);
      return runNormalize(f);
    }
    case 'graph': {
      const f = positional[0];
      if (!f) return fail('usage: pfdsl graph <file> [--format dot|svg]\n', 2);
      const fmt = flags.format;
      if (fmt !== undefined && fmt !== 'dot' && fmt !== 'svg') {
        return fail(`unknown format: ${String(fmt)}\n`, 2);
      }
      return runGraph(f, fmt ? { format: fmt as 'dot' | 'svg' } : {});
    }
    case 'diff': {
      const [a, b] = positional;
      if (!a || !b) return fail('usage: pfdsl diff <a> <b>\n', 2);
      return runDiff(a, b);
    }
    default:
      return fail(`unknown command: ${command}\n${HELP}`, 2);
  }
}
