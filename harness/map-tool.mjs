// Map a harness-native tool call onto the Claude-shaped names the core
// classifier already understands. PURE: no I/O. Adapters only; do not fork
// policy here.

// Intentional defensive/forward tool-name coverage. Over-inclusive mapping is
// the safe direction for an enforcement gate: classify() defaults an unknown
// tool name to category A (inspect/allow), so an unmapped mutation/delegation
// alias would slip through, while an extra alias only routes to a category the
// core already understands. multiedit/notebookedit/agent are real ecosystem
// tool names mapped now as forward coverage, not accidental scope.
const NAME = {
  bash: 'Bash',
  shell: 'Bash',
  write: 'Write',
  edit: 'Edit',
  strreplace: 'Edit',
  multiedit: 'MultiEdit',
  notebookedit: 'NotebookEdit',
  editnotebook: 'NotebookEdit',
  task: 'Task',
  agent: 'Agent',
  delete: 'Write',
};

function pathOf(input) {
  return input.file_path || input.notebook_path || input.path || input.filePath || input.file;
}

export function mapTool(toolName, toolInput = {}) {
  const raw = toolName == null ? '' : String(toolName);
  const mapped = NAME[raw.toLowerCase()] || raw;
  const next = { ...toolInput };
  const path = pathOf(next);
  if (path != null && next.file_path == null) next.file_path = path;
  if (next.command == null && next.cmd != null) next.command = next.cmd;
  return { toolName: mapped, toolInput: next };
}
