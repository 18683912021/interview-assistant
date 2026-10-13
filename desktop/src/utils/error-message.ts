/** Electron wraps rejected IPC calls; show the actionable cause, not bridge details. */
export function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return '操作失败，请重试';
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
