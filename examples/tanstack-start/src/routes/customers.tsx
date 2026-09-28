import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { MetricCard, PageHeader } from "#components/crm-ui";
import { CustomerTable } from "#components/customer-table";
import { customers } from "#lib/crm-data";
import { useView } from "#lib/tailorkit-client";

export const Route = createFileRoute("/customers")({ component: CustomersPage });

function CustomersPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useView("/customers", {
    context: { customers },
  });

  if (pathname !== "/customers") {
    return <Outlet />;
  }

  return (
    <div className="space-y-6">
      <PageHeader description="Accounts, owners, and current pipeline value." title="Customers" />

      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total" value={customers.length} />
        <MetricCard
          label="Active"
          value={customers.filter((customer) => customer.status === "Active").length}
        />
        <MetricCard
          label="At risk"
          value={customers.filter((customer) => customer.status === "At risk").length}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold text-lg">Customer list</h2>
          <p className="text-muted-foreground text-sm">
            Click through to view contact details and next steps.
          </p>
        </div>
        <CustomerTable />
      </section>
    </div>
  );
}
