const noop = (..._args: unknown[]) => {}
export const opsLog = { info: noop, warn: noop, error: noop, security: noop, debug: noop }
