export function createEventPayload(data: Record<string, unknown>) { return { ...data, timestamp: new Date().toISOString() } }
