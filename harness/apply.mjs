// Harness-native rendering of a core gate decision. PURE: no I/O.
// OpenCode denies by throwing; Pi by {block:true}; Cursor by a stdout object.
// OpenCode and Pi have no `ask` shape, so ask is rendered as a deny/block
// carrying the core reason. Cursor accepts `ask` on the schema but does not
// enforce it on preToolUse (documented parity gap).

export function applyOpenCode(result) {
  if (result && (result.decision === 'deny' || result.decision === 'ask')) {
    throw new Error(result.reason || 'denied by No Deceit');
  }
}

export function applyPi(result) {
  if (result && (result.decision === 'deny' || result.decision === 'ask')) {
    return { block: true, reason: result.reason };
  }
  return {};
}

export function renderCursor(result) {
  if (result && result.decision === 'deny') {
    return {
      permission: 'deny',
      user_message: result.reason,
      agent_message: result.reason,
    };
  }
  if (result && result.decision === 'ask') {
    return {
      permission: 'ask',
      user_message: result.reason,
      agent_message: result.reason,
    };
  }
  return { permission: 'allow' };
}
