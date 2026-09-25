// Guards every shipped skill/agent Markdown file's YAML frontmatter against
// strict-YAML-parse failures. Claude Code's lenient frontmatter parser
// accepts things a strict parser (Pi's, standard PyYAML) rejects — e.g. an
// unquoted scalar containing ": " reads as a nested mapping. Walk every
// *.md under skills/ and agents/ and strict-parse its frontmatter block.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function findMarkdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findMarkdownFiles(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const targets = [join(repoRoot, 'skills'), join(repoRoot, 'agents')];
const mdFiles = targets.flatMap(findMarkdownFiles);

test('found shipped skill/agent Markdown files to check', () => {
  assert.ok(mdFiles.length > 0, 'expected at least one *.md under skills/ or agents/');
});

for (const file of mdFiles) {
  const rel = file.slice(repoRoot.length + 1);
  test(`${rel} frontmatter strict-YAML-parses`, () => {
    const text = readFileSync(file, 'utf8');
    const match = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(match, `${rel} has no --- frontmatter block`);
    let doc;
    assert.doesNotThrow(() => {
      doc = parseYaml(match[1], { strict: true });
    }, `${rel} frontmatter failed strict YAML parse`);
    assert.equal(typeof doc.name, 'string');
    assert.equal(typeof doc.description, 'string');
  });
}
