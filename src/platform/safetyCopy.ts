import { studio } from '../core/store';
import { getRecoveryState, readFailedRecovery, readStoredRecovery } from './storage';
import { reportFailure } from './feedback';

/** Recovery/export must remain usable even when there is no working renderer. */
export async function downloadSafetyCopy() {
  try {
    const held = getRecoveryState().writeHeld;
    let liveError: unknown;
    if (!held) {
      try {
        const current = studio.recoverySnapshot();
        if (current && window.studioDesktop) {
          // A null result is an explicit cancellation of the native save dialog.
          await window.studioDesktop.saveProject(current);
          return;
        }
      } catch (error) {
        liveError = error;
      }
    }
    const stored = held ? await readFailedRecovery() : await readStoredRecovery();
    if (!stored) throw liveError ?? Error('There is no stored project to download on this device.');
    const url = URL.createObjectURL(new Blob([stored.content], { type: stored.type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = stored.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (error) {
    reportFailure('Could not download recovery: ' + (error as Error).message);
  }
}
