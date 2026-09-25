// Forwarder for the skills-dir install (`~/.claude/skills/no-deceit` → this
// directory's parent). Node resolves this file's real path before resolving
// the import, so the `../../../hooks/` hop is taken from the checkout, not
// from the symlink — a `${CLAUDE_PLUGIN_ROOT}/../..` command line is not
// reliable across shells and harnesses. All policy stays in ../../../hooks and core/.
import '../../../hooks/nd-hook.mjs';
