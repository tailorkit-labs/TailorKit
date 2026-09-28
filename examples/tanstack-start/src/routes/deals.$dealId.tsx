import { Badge } from "@tailorkit/ui/badge";
import { buttonVariants } from "@tailorkit/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tailorkit/ui/card";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { DetailCard } from "#components/crm-ui";
import { getDeal } from "#lib/crm-data";

export const Route = createFileRoute("/deals/$dealId")({
  component: DealDetailPage,
  loader: ({ params }) => {
    const deal = getDeal(params.dealId);

    if (!deal) {
      throw notFound();
    }

    return { deal };
  },
});

function DealDetailPage() {
  const { deal } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <Link className={buttonVariants({ size: "sm", variant: "ghost" })} to="/deals">
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        Deals
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-2xl tracking-normal">{deal.account}</h1>
          <Badge variant="secondary">{deal.stage}</Badge>
        </div>
        <p className="mt-1 text-muted-foreground text-sm">{deal.amount}</p>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="p-4">
          <CardTitle>Deal details</CardTitle>
          <CardDescription>Current sales motion and close plan.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-4 pb-4 pt-0 sm:grid-cols-2">
          <DetailCard label="Owner" value={deal.owner} />
          <DetailCard label="Close date" value={deal.closeDate} />
          <DetailCard label="Probability" value={deal.probability} />
          <DetailCard label="Next step" value={deal.nextStep} />
        </CardContent>
      </Card>
    </div>
  );
}
