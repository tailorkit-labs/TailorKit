import Link from "next/link";
import { Badge } from "@tailorkit/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
} from "@tailorkit/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@tailorkit/ui/table";
import { cn } from "@tailorkit/ui";
import { deals } from "@/lib/crm-data";

export function PageHeader({ description, title }: { description?: string; title: string }) {
  return (
    <div>
      <h1 className="font-semibold text-2xl tracking-normal">{title}</h1>
      {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="p-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="mt-1 font-medium text-sm">{value}</p>
      </CardContent>
    </Card>
  );
}

export function DealTable() {
  return (
    <CardFrame className="w-full">
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((deal) => (
            <TableRow key={deal.id}>
              <TableCell className="font-medium">
                <Link className="hover:underline" href={`/deals/${deal.id}`}>
                  {deal.account}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 rounded-full", getStageIndicatorClassName(deal.stage))}
                  />
                  {deal.stage}
                </Badge>
              </TableCell>
              <TableCell>{deal.owner}</TableCell>
              <TableCell className="text-right">{deal.amount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total pipeline</TableCell>
            <TableCell className="text-right">{formatCurrencyTotal(deals)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </CardFrame>
  );
}

export function formatCurrencyTotal(rows: { amount?: string; value?: string }[]) {
  const total = rows.reduce((sum, row) => {
    const currency = row.amount ?? row.value ?? "$0";

    return sum + Number(currency.replaceAll(/[$,]/gu, ""));
  }, 0);

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(total);
}

function getStageIndicatorClassName(stage: string) {
  if (stage === "Negotiation") {
    return "bg-success";
  }

  if (stage === "Proposal") {
    return "bg-info";
  }

  return "bg-warning";
}
