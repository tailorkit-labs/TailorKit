import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { demoAuthCookieName, getDemoUser } from "@examples/shared";
import { Badge } from "@tailorkit/ui/badge";
import { buttonVariants } from "@tailorkit/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tailorkit/ui/card";
import { DetailCard } from "@/components/crm-ui";
import { CustomerDetailView } from "@/components/customer-screen";
import { getCustomer } from "@/lib/crm-data";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const customer = getCustomer(customerId);
  const cookieStore = await cookies();
  const user = getDemoUser(cookieStore.get(demoAuthCookieName)?.value);

  if (!customer || !user) {
    notFound();
  }

  return (
    <>
      <CustomerDetailView context={{ customer }} />
      <div className="flex flex-col gap-6">
        <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href="/customers">
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          Customers
        </Link>

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
            <CardContent className="grid gap-3 px-4 pt-0 pb-4 sm:grid-cols-2">
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
            <CardContent className="flex flex-col gap-3 px-4 pt-0 pb-4 text-sm">
              <a
                className="flex items-center gap-2 hover:underline"
                href={`mailto:${customer.email}`}
              >
                <Mail aria-hidden="true" className="size-4 text-muted-foreground" />
                {customer.email}
              </a>
              <a className="flex items-center gap-2 hover:underline" href={`tel:${customer.phone}`}>
                <Phone aria-hidden="true" className="size-4 text-muted-foreground" />
                {customer.phone}
              </a>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
