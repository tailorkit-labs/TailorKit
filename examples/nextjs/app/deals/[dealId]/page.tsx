import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@tailorkit/ui/badge";
import { buttonVariants } from "@tailorkit/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tailorkit/ui/card";
import { DetailCard } from "@/components/crm-ui";
import { getDeal } from "@/lib/crm-data";

export default async function DealDetailPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const deal = getDeal(dealId);

  if (!deal) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href="/deals">
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
        <CardContent className="grid gap-3 px-4 pt-0 pb-4 sm:grid-cols-2">
          <DetailCard label="Owner" value={deal.owner} />
          <DetailCard label="Close date" value={deal.closeDate} />
          <DetailCard label="Probability" value={deal.probability} />
          <DetailCard label="Next step" value={deal.nextStep} />
        </CardContent>
      </Card>
    </div>
  );
}
