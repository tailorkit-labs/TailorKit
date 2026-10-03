import { Logo } from "@tailorkit/ui/logo";
import { Link } from "@tanstack/react-router";

export function SidebarBrand() {
  return (
    <Link className="flex items-center gap-2" to="/">
      <Logo className="size-6 text-foreground" />
      <span className="font-semibold text-base">TailorKit</span>
    </Link>
  );
}
