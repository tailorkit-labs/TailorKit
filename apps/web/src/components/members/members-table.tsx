import { useMemo, useState } from "react";
import { flexRender, useTable } from "@tanstack/react-table";
import type { CellContext, ColumnDef, SortingState } from "@tanstack/react-table";
import { MoreHorizontalIcon, TrashIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@tailorkit/ui/avatar";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import { CardFrame } from "@tailorkit/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tailorkit/ui/dropdown-menu";
import { DateAgo } from "@tailorkit/ui/date";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tailorkit/ui/table";
import { getRoleBadgeVariant, renderSortableHeader } from "./member-table-utils";
import { dataTableFeatures } from "#lib/table";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date | string;
  userId: string;
  isCurrentUser: boolean;
  isOwner: boolean;
}

interface MemberColumnsOptions {
  canManage: boolean;
  onRemove: (memberId: string) => void;
  removePending: boolean;
}

function createMemberColumns({
  canManage,
  onRemove,
  removePending,
}: MemberColumnsOptions): ColumnDef<typeof dataTableFeatures, MemberRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Member",
      size: 280,
      cell: ({ row }: CellContext<typeof dataTableFeatures, MemberRow, unknown>) => {
        const initials = row.original.name
          .split(" ")
          .map((word: string) => word[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
        return (
          <div className="flex items-center gap-3">
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium text-sm leading-tight">
                {row.original.name}
                {row.original.isCurrentUser && (
                  <span className="ml-1.5 text-muted-foreground text-xs font-normal">(you)</span>
                )}
              </p>
              <p className="truncate text-muted-foreground text-xs leading-tight">
                {row.original.email}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      size: 110,
      cell: ({ row }: CellContext<typeof dataTableFeatures, MemberRow, unknown>) => (
        <Badge variant={getRoleBadgeVariant(row.original.role)} size="lg">
          {row.original.role.charAt(0).toUpperCase() + row.original.role.slice(1)}
        </Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Last Active",
      size: 140,
      sortFn: "datetime",
      cell: ({ row }: CellContext<typeof dataTableFeatures, MemberRow, unknown>) => (
        <DateAgo date={row.original.createdAt} />
      ),
    },
    {
      id: "actions",
      size: 80,
      enableSorting: false,
      header: () => null,
      cell: ({ row }: CellContext<typeof dataTableFeatures, MemberRow, unknown>) => (
        <div className="flex items-center justify-end gap-1">
          {canManage && !row.original.isCurrentUser && !row.original.isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" />}>
                <MoreHorizontalIcon className="size-4" />
                <span className="sr-only">Open member actions</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  disabled={removePending}
                  variant="destructive"
                  onClick={() => onRemove(row.original.id)}
                >
                  <TrashIcon />
                  Remove member
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
    },
  ];
}

export function MembersTable({
  members,
  canManage,
  onRemove,
  removePending,
  search,
}: {
  members: MemberRow[];
  canManage: boolean;
  onRemove: (memberId: string) => void;
  removePending: boolean;
  search: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return members;
    }

    return members.filter(
      (member) =>
        member.name.toLowerCase().includes(normalizedSearch) ||
        member.email.toLowerCase().includes(normalizedSearch),
    );
  }, [members, search]);

  const columns = useMemo<ColumnDef<typeof dataTableFeatures, MemberRow>[]>(
    () => createMemberColumns({ canManage, onRemove, removePending }),
    [canManage, onRemove, removePending],
  );

  const table = useTable({
    columns,
    data: filtered,
    enableSortingRemoval: false,
    features: dataTableFeatures,
    onSortingChange: setSorting,
    state: { sorting },
  });

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
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell className="h-24 text-center" colSpan={columns.length}>
                No members found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </CardFrame>
  );
}
