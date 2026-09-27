import { Badge } from "@tailorkit/ui/badge";
import { CardFrame } from "@tailorkit/ui/card";
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
import { formatCurrencyTotal } from "#components/crm-ui";
import { customers } from "#lib/crm-data";

export function CustomerTable({ limit }: { limit?: number }) {
  const visibleCustomers = typeof limit === "number" ? customers.slice(0, limit) : customers;

  return (
    <CardFrame className="w-full">
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleCustomers.map((customer) => (
            <TableRow key={customer.id}>
              <TableCell className="font-medium">{customer.name}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      getStatusIndicatorClassName(customer.status),
                    )}
                  />
                  {customer.status}
                </Badge>
              </TableCell>
              <TableCell>{customer.owner}</TableCell>
              <TableCell className="text-right">{customer.value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total Value</TableCell>
            <TableCell className="text-right">{formatCurrencyTotal(visibleCustomers)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </CardFrame>
  );
}

function getStatusIndicatorClassName(status: string) {
  if (status === "Active") {
    return "bg-emerald-500";
  }

  if (status === "At risk") {
    return "bg-amber-500";
  }

  return "bg-sky-500";
}
