/** `ETag: "7"` — a bare integer is not a valid entity-tag. */
export function configToWireVersion(version: number): string {
  return `"${version}"`;
}
