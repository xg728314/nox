export const featureFlags: Record<string, boolean> = new Proxy({} as Record<string, boolean>, {
  get: () => false,
})
