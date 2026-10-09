import type { TailorKitTheme } from "tailorkit";
import { createClient, primitives as reactPrimitives } from "tailorkit/react";
import type React from "react";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tailorkit/ui/dropdown-menu";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@tailorkit/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@tailorkit/ui/card";
import { Checkbox } from "@tailorkit/ui/checkbox";
import { Input } from "@tailorkit/ui/input";
import { Separator } from "@tailorkit/ui/separator";
import { createDemoContract } from "./tailorkit";

export function createDemoTailorClient(theme: TailorKitTheme) {
  const contract = createDemoContract(theme);

  return createClient({
    contract,
    baseUrl:
      typeof window === "undefined"
        ? "http://localhost/api/tailorkit/"
        : new URL("/api/tailorkit/", window.location.origin),
    components: {
      ...reactPrimitives,
      Button: ({ props, children }) => (
        <Button
          onClick={typeof props.onClick === "function" ? props.onClick : undefined}
          size={props.size as React.ComponentProps<typeof Button>["size"]}
          variant={props.variant as React.ComponentProps<typeof Button>["variant"]}
        >
          {children}
        </Button>
      ),
      Badge: ({ props, children }) => (
        <Badge
          size={props.size as React.ComponentProps<typeof Badge>["size"]}
          variant={props.variant as React.ComponentProps<typeof Badge>["variant"]}
        >
          {children}
        </Badge>
      ),
      Card: ({ children }) => <Card>{children}</Card>,
      CardHeader: ({ children }) => <CardHeader>{children}</CardHeader>,
      CardTitle: ({ children }) => <CardTitle>{children}</CardTitle>,
      CardDescription: ({ children }) => <CardDescription>{children}</CardDescription>,
      CardContent: ({ children }) => <CardContent>{children}</CardContent>,
      CardFooter: ({ children }) => <CardFooter>{children}</CardFooter>,
      Checkbox: ({ props }) => (
        <Checkbox
          checked={props.checked === "true"}
          onCheckedChange={
            typeof props.onCheckedChange === "function"
              ? (checked: boolean) => props.onCheckedChange(checked)
              : undefined
          }
        />
      ),
      Input: ({ props }) => {
        const handleInput =
          typeof props.onValueChange === "function"
            ? (event: { target: EventTarget | null }) =>
                props.onValueChange((event.target as HTMLInputElement).value)
            : undefined;

        return (
          <Input
            nativeInput
            onChange={handleInput}
            onInput={handleInput}
            placeholder={typeof props.placeholder === "string" ? props.placeholder : undefined}
            value={typeof props.value === "string" ? props.value : undefined}
          />
        );
      },
      Separator: () => <Separator />,
      DropdownMenu: ({ children }) => <DropdownMenu>{children}</DropdownMenu>,
      DropdownMenuTrigger: ({ children }) => <DropdownMenuTrigger>{children}</DropdownMenuTrigger>,
      DropdownMenuContent: ({ children }) => <DropdownMenuContent>{children}</DropdownMenuContent>,
      DropdownMenuItem: ({ props, children }) => (
        <DropdownMenuItem
          onClick={typeof props.onClick === "function" ? props.onClick : undefined}
          variant={props.variant as React.ComponentProps<typeof DropdownMenuItem>["variant"]}
        >
          {children}
        </DropdownMenuItem>
      ),
      DropdownMenuSeparator: () => <DropdownMenuSeparator />,
      Tabs: ({ props, children }) => (
        <Tabs
          value={typeof props.value === "string" ? props.value : undefined}
          onValueChange={
            typeof props.onValueChange === "function" ? props.onValueChange : undefined
          }
        >
          {children}
        </Tabs>
      ),
      TabsList: ({ children }) => <TabsList>{children}</TabsList>,
      TabsTab: ({ props, children }) => (
        <TabsTab value={typeof props.value === "string" ? props.value : ""}>{children}</TabsTab>
      ),
      TabsPanel: ({ props, children }) => (
        <TabsPanel value={typeof props.value === "string" ? props.value : ""}>{children}</TabsPanel>
      ),
    },
  });
}
