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

export function normalizeScopeSelection(scopes?: readonly string[]): {
  key: string;
  scopes?: readonly string[];
} {
  if (scopes === undefined) {
    return { key: "*" };
  }
  const names = [...new Set(scopes)].sort();
  return { key: JSON.stringify(names), scopes: names };
}
