type FailureNotice = { id: number; message: string };
let notice: FailureNotice | null = null;
let sequence = 0;
const listeners = new Set<() => void>();

/** Errors outlive transient status messages and remain available on every layout. */
export function reportFailure(message: string) {
  notice = { id: ++sequence, message };
  listeners.forEach((listener) => listener());
}
export function dismissFailure(id: number) {
  if (notice?.id !== id) return;
  notice = null;
  listeners.forEach((listener) => listener());
}
export const failureSnapshot = () => notice;
export function subscribeFailures(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
