"use client";

import { useViewContext } from "@/lib/tailorkit-client";
import type { Customer } from "@/lib/crm-data";

interface CustomerListContext {
  customers: Customer[];
}

export function CustomerListView({ context }: { context: CustomerListContext }) {
  useViewContext("/customers", { context });
  return null;
}

export function CustomerDetailView({ context }: { context: { customer: Customer } }) {
  useViewContext("/customers/detail", { context });
  return null;
}
