export function getSameOriginPath(value: string | undefined, currentOrigin: string) {
  if (!value) {
    return;
  }

  try {
    const url = new URL(value, currentOrigin);
    if (url.origin !== currentOrigin) {
      return;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Invalid URLs are not safe redirect targets.
  }
}

export function getSameOriginUrl(value: string | undefined, currentOrigin: string) {
  const path = getSameOriginPath(value, currentOrigin);

  if (!path) {
    return;
  }

  return new URL(path, currentOrigin).href;
}

export function getAuthErrorCallbackUrl(
  route: "/login" | "/sign-up",
  returnTo: string | undefined,
  currentOrigin: string,
) {
  const callbackUrl = new URL(route, currentOrigin);
  const returnPath = getSameOriginPath(returnTo, currentOrigin);

  if (returnPath) {
    callbackUrl.searchParams.set("return_to", returnPath);
  }

  return `${callbackUrl.pathname}${callbackUrl.search}`;
}
