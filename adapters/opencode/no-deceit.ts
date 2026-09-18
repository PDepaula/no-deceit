// OpenCode plugin: tool.execute.before → core → throw on deny/ask.
// Import the policy core in-process. Copy or point OpenCode at this file
// inside a full clone of this repo so ../run.mjs resolves.

import { createOpenCodePlugin } from './plugin.mjs';

export const NoDeceit = createOpenCodePlugin();
