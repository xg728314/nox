export function normalizeTagId(raw: string) {
  return (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9\-\_\:]/g, "")
    .replace(/[-_]{2,}/g, "-");
}
