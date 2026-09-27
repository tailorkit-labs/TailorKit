"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

export function ThemeProvider(props: ThemeProviderProps & { children?: ReactNode }) {
  return <NextThemesProvider {...props} />;
}
