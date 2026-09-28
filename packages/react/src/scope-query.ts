export function appendScopeSelection(url: URL, scopes?: readonly string[]): void {
  if (scopes === undefined) {
    return;
  }
  if (scopes.length === 0) {
    url.searchParams.append("scopes", "");
    return;
  }
  for (const scope of scopes) {
    url.searchParams.append("scopes", scope);
  }
}

export function sameScopeSelection(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((scope, index) => scope === right[index]))
  );
}
