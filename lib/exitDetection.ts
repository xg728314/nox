export const EXIT_CONFIRM_MS = 5000
export const useExitDetectionStore = (_selector: (s: { setExitConfirmMsOverride: (ms: number) => void }) => unknown) => () => {}
export function emitRoomExitWarn(_data: unknown) {}
export function setSimulatedLastSeen(_ts: number | null) {}
export function clearSimulatedLastSeen() {}
