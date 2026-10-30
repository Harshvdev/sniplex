import { isTauriEnvironment } from './capture';

let enabled = false;

/**
 * Enables the opt-in capture timing probe (SNIPLEX_TIMING=1).
 * The probe appends `epoch-ms actor marker` lines to the timing log written by
 * the backend, so the whole click -> overlay reveal path can be reconstructed.
 */
export async function initTiming(): Promise<void> {
  if (!isTauriEnvironment()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    enabled = await invoke<boolean>('timing_enabled');
  } catch {
    enabled = false;
  }
}

export function mark(marker: string): void {
  if (!enabled) return;
  const line = `${Date.now()} js ${marker}`;
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('log_timing', { line }))
    .catch(() => {});
}
