export type BleLogLevel = "info" | "warn" | "error";

export type BleLogEntry = {
  ts: number;
  level: BleLogLevel;
  text: string;
};

type Listener = (entry: BleLogEntry) => void;

const listeners = new Set<Listener>();

/**
 * Global lightweight logger for BLE pipeline guards/diagnostics.
 * - Always logs to console
 * - Optionally fan-outs to in-app subscribers (Dev HUD, Ops tools, etc.)
 */
export function pushLog(text: string, level: BleLogLevel = "warn"): void {
  const entry: BleLogEntry = { ts: Date.now(), level, text };

  if (level === "error") console.error(text);
  else if (level === "info") console.info(text);
  else console.warn(text);

  for (const fn of Array.from(listeners)) {
    try {
      fn(entry);
    } catch {
      // ignore listener errors
    }
  }
}

export function subscribeBleLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

