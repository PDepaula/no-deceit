// Map a harness-native tool call onto the Claude-shaped names the core
// classifier already understands. PURE: no I/O. Adapters only; do not fork
// policy here.

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
