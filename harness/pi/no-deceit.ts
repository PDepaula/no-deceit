// Pi extension: tool_call → core → {block:true, reason} on deny/ask.
// Import the policy core in-process. Keep this file inside a full clone of
// this repo so ../run.mjs resolves (symlink the file, do not copy it).

import { createPiExtension } from './extension.mjs';

export default createPiExtension();
