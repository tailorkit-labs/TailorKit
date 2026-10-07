"use client";

import { useRegisterView } from "@/lib/tailorkit-client";
import type { Customer } from "@/lib/crm-data";

interface CustomerListContext {
  customers: Customer[];
}

export function CustomerListView({ context }: { context: CustomerListContext }) {
  useRegisterView("/customers", { context });
  return null;
}

export function CustomerDetailView({ context }: { context: { customer: Customer } }) {
  useRegisterView("/customers/detail", { context });
  return null;
}
