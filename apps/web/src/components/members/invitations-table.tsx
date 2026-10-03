import { useMemo, useState } from "react";
import { flexRender, useTable } from "@tanstack/react-table";
import type { CellContext, ColumnDef, SortingState } from "@tanstack/react-table";
import { MoreHorizontalIcon, SendIcon, TrashIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@tailorkit/ui/avatar";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import { CardFrame } from "@tailorkit/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tailorkit/ui/dropdown-menu";
import { DateAgo } from "@tailorkit/ui/date";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tailorkit/ui/table";
import { getRoleBadgeVariant, renderSortableHeader } from "./member-table-utils";
import { dataTableFeatures } from "#lib/table";

export interface InvitationRow {
  id: string;
  email: string;
  role: string | null;
  expiresAt: Date | string;
}

interface InvitationColumnsOptions {
  canManage: boolean;
  onResend: (invitation: InvitationRow) => void;
  onRevoke: (invitationId: string) => void;
  resendPending: boolean;
  revokePending: boolean;
}

function createInvitationColumns({
  canManage,
  onResend,
  onRevoke,
  resendPending,
  revokePending,
}: InvitationColumnsOptions): ColumnDef<typeof dataTableFeatures, InvitationRow>[] {
  return [
    {
      accessorKey: "email",
      header: "Email",
      size: 280,
      cell: ({ row }: CellContext<typeof dataTableFeatures, InvitationRow, unknown>) => {
        const initials = row.original.email.slice(0, 2).toUpperCase();
        return (
          <div className="flex items-center gap-3">
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <p className="truncate font-medium text-sm">{row.original.email}</p>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      size: 110,
      cell: ({ row }: CellContext<typeof dataTableFeatures, InvitationRow, unknown>) => {
        const role = row.original.role ?? "member";
        return (
          <Badge variant={getRoleBadgeVariant(role)} size="lg">
            {role.charAt(0).toUpperCase() + role.slice(1)}
          </Badge>
        );
      },
    },
    {
      accessorKey: "expiresAt",
      header: "Expires",
      size: 140,
      sortFn: "datetime",
      cell: ({ row }: CellContext<typeof dataTableFeatures, InvitationRow, unknown>) => (
        <DateAgo date={row.original.expiresAt} />
      ),
    },
    {
      id: "actions",
      size: 80,
      enableSorting: false,
      header: () => null,
      cell: ({ row }: CellContext<typeof dataTableFeatures, InvitationRow, unknown>) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" />}>
                <MoreHorizontalIcon className="size-4" />
                <span className="sr-only">Open invitation actions</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem disabled={resendPending} onClick={() => onResend(row.original)}>
                  <SendIcon />
                  Resend email
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={revokePending}
                  variant="destructive"
                  onClick={() => onRevoke(row.original.id)}
                >
                  <TrashIcon />
                  Revoke invite
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
    },
  ];
}

export function InvitationsTable({
  invitations,
  canManage,
  onResend,
  onRevoke,
  resendPending,
  revokePending,
}: {
  invitations: InvitationRow[];
  canManage: boolean;
  onResend: (invitation: InvitationRow) => void;
  onRevoke: (invitationId: string) => void;
  resendPending: boolean;
  revokePending: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "email", desc: false }]);

  const columns = useMemo<ColumnDef<typeof dataTableFeatures, InvitationRow>[]>(
    () => createInvitationColumns({ canManage, onResend, onRevoke, resendPending, revokePending }),
    [canManage, onResend, onRevoke, resendPending, revokePending],
  );

  const table = useTable({
    columns,
    data: invitations,
    enableSortingRemoval: false,
    features: dataTableFeatures,
    onSortingChange: setSorting,
    state: { sorting },
  });

  if (invitations.length === 0) {
    return (
      <div className="rounded-lg border px-4 py-12 text-center text-muted-foreground text-sm">
        No pending invitations.
      </div>
    );
  }

  return (
    <CardFrame className="w-full">
      <Table variant="card" className="table-fixed">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow className="hover:bg-transparent" key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const columnSize = header.column.getSize();
                return (
                  <TableHead
                    key={header.id}
                    style={columnSize ? { width: `${columnSize}px` } : undefined}
                  >
                    {renderSortableHeader(header)}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardFrame>
  );
}
