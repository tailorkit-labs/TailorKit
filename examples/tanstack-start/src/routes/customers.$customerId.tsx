import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tailorkit/ui/card";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { DetailCard } from "#components/crm-ui";
import { getCustomer } from "#lib/crm-data";
import { useAuthSession } from "#lib/auth-client";
import { useView } from "#lib/tailorkit-client";

export const Route = createFileRoute("/customers/$customerId")({
  component: CustomerDetailPage,
  loader: ({ params }) => {
    const customer = getCustomer(params.customerId);

    if (!customer) {
      throw notFound();
    }

    return { customer };
  },
});

function CustomerDetailPage() {
  const { customer } = Route.useLoaderData();
  const session = useAuthSession();

  useView(
    "/customers/detail",
    session.data
      ? {
          context: { customer },
        }
      : {
          status: "loading",
        },
  );

  return (
    <div className="space-y-6">
      <Button size="sm" variant="ghost" render={<Link to="/customers" />}>
        <ArrowLeft aria-hidden="true" />
        Customers
      </Button>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-2xl tracking-normal">{customer.name}</h1>
          <Badge variant="secondary">{customer.status}</Badge>
        </div>
        <p className="mt-1 text-muted-foreground text-sm">{customer.company}</p>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card className="rounded-lg">
          <CardHeader className="p-4">
            <CardTitle>Account</CardTitle>
            <CardDescription>{customer.notes}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 px-4 pb-4 pt-0 sm:grid-cols-2">
            <DetailCard label="Owner" value={customer.owner} />
            <DetailCard label="Value" value={customer.value} />
            <DetailCard label="Last contact" value={customer.lastContact} />
            <DetailCard label="Next step" value={customer.nextStep} />
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="p-4">
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4 pt-0 text-sm">
            <a
              className="flex items-center gap-2 hover:underline"
              href={`mailto:${customer.email}`}
            >
              <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
              {customer.email}
            </a>
            <a className="flex items-center gap-2 hover:underline" href={`tel:${customer.phone}`}>
              <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
              {customer.phone}
            </a>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
