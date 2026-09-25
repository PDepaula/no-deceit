// JS side of the port oracle: proves every oracle/cases/*.json expectation
// against the Node module. The JS suite is the source of truth; the Babashka
// twin (test/no_deceit/oracle_test.clj) must agree with these same cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(root, 'oracle', 'cases');

for (const f of readdirSync(casesDir).filter((n) => n.endsWith('.json')).sort()) {
  const spec = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
  test(`oracle cases: ${spec.module}`, async () => {
    const mod = await import(pathToFileURL(join(root, spec.js.file)).href);
    for (const c of spec.cases) {
      const got = JSON.parse(JSON.stringify(mod[spec.js.fn](...c.args)));
      assert.deepEqual(got, c.expect, c.name);
    }
  });
}
