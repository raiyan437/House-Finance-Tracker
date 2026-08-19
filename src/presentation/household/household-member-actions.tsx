"use client";

import { useRef, type RefObject } from "react";
import { MoreHorizontal, ShieldCheck, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HouseholdMemberView } from "@/application/household/household-page";

export type MemberManagementAction = "transfer" | "remove";

export function HouseholdMemberActions({
  member,
  position,
  total,
  onAction,
}: Readonly<{
  member: HouseholdMemberView;
  position: number;
  total: number;
  onAction: (
    action: MemberManagementAction,
    memberId: HouseholdMemberView["memberId"],
    triggerRef: RefObject<HTMLButtonElement | null>,
  ) => void;
}>) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Manage ${member.displayName}, member ${position} of ${total}`}
          className="size-11"
          ref={triggerRef}
          size="icon"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => onAction("transfer", member.memberId, triggerRef)}
        >
          <ShieldCheck aria-hidden="true" /> Transfer Leadership
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-danger focus:bg-danger-soft"
          disabled={!member.remove?.eligible}
          onSelect={() => onAction("remove", member.memberId, triggerRef)}
        >
          <UserMinus aria-hidden="true" /> Remove Member
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
