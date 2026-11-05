import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sources(path) : /\.(css|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test('the UI uses exactly five shared font sizes without local size escape hatches', () => {
  const web = resolve('apps/web/src');
  const tokens = readFileSync(resolve(web, 'styles/tokens.css'), 'utf8');
  const scale = Object.fromEntries(
    [...tokens.matchAll(/--font-([a-z]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2]]),
  );
  expect(scale).toEqual({ xs: '12px', sm: '13px', md: '14px', lg: '18px', xl: '24px' });

  const files = [
    ...sources(web),
    ...sources(resolve('packages/plugin-rnd/src')),
    ...sources(resolve('packages/plugin-ops/src')),
  ];
  const violations: string[] = [];
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/\bfont-size\s*:\s*([^;{}]+);/g)) {
      if (!/^var\(--font-(xs|sm|md|lg|xl)\)$/.test(match[1].trim()))
        violations.push(`${path}: font-size: ${match[1]}`);
    }
    for (const match of source.matchAll(/\bfont\s*:\s*([^;{}]+);/g)) {
      if (match[1].trim() !== 'inherit') violations.push(`${path}: font shorthand: ${match[1]}`);
    }
    for (const match of source.matchAll(/\bfontSize\s*:\s*([^,}\n]+)/g)) {
      if (!/^['"]var\(--font-(xs|sm|md|lg|xl)\)['"]$/.test(match[1].trim()))
        violations.push(`${path}: inline fontSize: ${match[1]}`);
    }
    if (/\btext-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]+\])\b/.test(source))
      violations.push(`${path}: font utility bypasses the shared scale`);
  }
  expect(violations).toEqual([]);
});
