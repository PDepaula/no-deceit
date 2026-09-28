// No Deceit — curriculum file I/O (the imperative shell around core/curriculum.mjs).

import { readFileSync } from 'node:fs';
import { dataPaths } from './state.mjs';

function readOrNull(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

/** { open, sealed } text for a topic; a missing file is null. */
export function readCurriculum(env, topic) {
  const dp = dataPaths(env);
  return { open: readOrNull(dp.curriculumOpen(topic)), sealed: readOrNull(dp.curriculumSealed(topic)) };
}
