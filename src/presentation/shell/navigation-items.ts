import {
  CreditCard,
  HandCoins,
  House,
  LayoutDashboard,
  ReceiptText,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly isActive: (pathname: string) => boolean;
}

export const desktopNavigationItems: readonly NavigationItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    isActive: (pathname) => pathname === "/dashboard",
  },
  {
    label: "Expenses",
    href: "/expenses",
    icon: ReceiptText,
    isActive: (pathname) => pathname.startsWith("/expenses"),
  },
  {
    label: "Settlements",
    href: "/settlements",
    icon: HandCoins,
    isActive: (pathname) => pathname.startsWith("/settlements"),
  },
  {
    label: "Cards",
    href: "/cards",
    icon: CreditCard,
    isActive: (pathname) => pathname.startsWith("/cards"),
  },
  {
    label: "Household",
    href: "/household",
    icon: House,
    isActive: (pathname) => pathname.startsWith("/household"),
  },
] as const;

export const moreNavigationItems: readonly NavigationItem[] = [
  desktopNavigationItems[3],
  desktopNavigationItems[4],
  {
    label: "Profile",
    href: "/profile",
    icon: UserRound,
    isActive: (pathname) => pathname.startsWith("/profile"),
  },
] as const;
