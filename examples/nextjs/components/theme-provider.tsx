"use client";

import type { ComponentProps, ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider(
  props: ComponentProps<typeof NextThemesProvider> & { children: ReactNode },
) {
  return <NextThemesProvider {...props} />;
}
