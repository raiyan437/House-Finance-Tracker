"use client";

import type { RefObject } from "react";
import { Crown } from "lucide-react";
import type { HouseholdMemberView } from "@/application/household/household-page";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { StatusBadge } from "@/presentation/components/status-badge";
import { HouseholdActionExplanations } from "./household-action-copy";
import {
  HouseholdMemberActions,
  type MemberManagementAction,
} from "./household-member-actions";

export function HouseholdMemberList({
  members,
  viewerRole,
  onAction,
  actionsDisabled = false,
}: Readonly<{
  members: readonly HouseholdMemberView[];
  viewerRole: "leader" | "member";
  onAction: (
    action: MemberManagementAction,
    memberId: HouseholdMemberView["memberId"],
    triggerRef: RefObject<HTMLButtonElement | null>,
  ) => void;
  actionsDisabled?: boolean;
}>) {
  return (
    <ul aria-label="Active household members" className="mt-4 divide-y">
      {members.map((member, index) => (
        <li className="py-4" key={member.memberId}>
          <div className="flex min-w-0 items-center gap-3">
            <MemberAvatar className="size-11" displayName={member.displayName} userId={member.memberId} />
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">
                {member.displayName}
                {member.isCurrentUser ? (
                  <span className="ml-2 text-caption font-normal text-text-secondary">You</span>
                ) : null}
              </p>
              <p className="mt-0.5 text-caption text-text-secondary">{member.roleLabel}</p>
            </div>
            {member.role === "leader" ? (
              <StatusBadge tone="success">
                <Crown aria-hidden="true" className="mr-1 inline size-3" /> Leader
              </StatusBadge>
            ) : null}
            {viewerRole === "leader" && member.remove ? (
              <HouseholdMemberActions
                disabled={actionsDisabled}
                member={member}
                onAction={onAction}
                position={index + 1}
                total={members.length}
              />
            ) : null}
          </div>
          {viewerRole === "leader" && member.remove && !member.remove.eligible ? (
            <div className="ml-14">
              <HouseholdActionExplanations
                preview={member.remove}
                targetName={member.displayName}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
