import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const getPreferredLocale = createIsomorphicFn()
  .server(() => {
    const locale = getRequest()
      .headers.get("accept-language")
      ?.split(",")[0]
      ?.split(";")[0]
      ?.trim();

    if (!locale || locale === "*") {
      return "en";
    }

    try {
      return Intl.getCanonicalLocales(locale)[0] ?? "en";
    } catch {
      return "en";
    }
  })
  .client(() => navigator.language);

export const getPreferredTimeZone = createIsomorphicFn()
  .server(() => getRequest().headers.get("x-vercel-ip-timezone") ?? "UTC")
  .client(() => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
