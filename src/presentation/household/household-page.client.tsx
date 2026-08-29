"use client";

import Link from "next/link";
import { useRef, useState, type RefObject } from "react";
import { ArrowRight, Crown, House, LogOut, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import type {
  ActiveHouseholdPageView,
  HouseholdMemberView,
} from "@/application/household/household-page";
import type { LeaderJoinRequestView } from "@/application/services/application-services";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/presentation/components/confirm-dialog";
import { ErrorState, LoadingState } from "@/presentation/components/async-state";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { StatusBadge } from "@/presentation/components/status-badge";
import { Surface } from "@/presentation/components/surface";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { CapabilityNotice, useCapability } from "@/presentation/runtime/capability-gate.client";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { HouseCodeControls } from "./house-code-controls";
import { HouseholdActionExplanations } from "./household-action-copy";
import { HouseholdManagementDialog, type HouseholdDialogAction } from "./household-management-dialog";
import { HouseholdMemberList } from "./household-member-list";
import { RenameHouseholdDialog } from "./rename-household-dialog.client";
import type { MemberManagementAction } from "./household-member-actions";

function HouseholdIdentity({ name, code }: Readonly<{ name: string; code: string }>) {
  return (
    <div className="min-w-0">
      <p className="panel-title break-words">{name}</p>
      <HouseCodeControls code={code} />
    </div>
  );
}

function NoHouseholdState() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Surface className="flex min-h-56 flex-col">
        <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft">
          <House aria-hidden="true" className="size-5" />
        </span>
        <h2 className="panel-title mt-6">Create a Household</h2>
        <p className="mt-2 flex-1 text-body text-text-secondary">Start a household and become its leader.</p>
        <Button asChild className="mt-6 w-full sm:w-fit">
          <Link href="/household/create">Create a Household <ArrowRight aria-hidden="true" /></Link>
        </Button>
      </Surface>
      <Surface className="flex min-h-56 flex-col">
        <span className="flex size-11 items-center justify-center rounded-full bg-secondary">
          <UserPlus aria-hidden="true" className="size-5" />
        </span>
        <h2 className="panel-title mt-6">Join a Household</h2>
        <p className="mt-2 flex-1 text-body text-text-secondary">Use a nine-digit code to request access.</p>
        <Button asChild className="mt-6 w-full sm:w-fit" variant="outline">
          <Link href="/household/join">Join a Household <ArrowRight aria-hidden="true" /></Link>
        </Button>
      </Surface>
    </div>
  );
}

function LeaderRequestRow({ request, householdName }: Readonly<{ request: LeaderJoinRequestView; householdName: string }>) {
  const runtime = useApplicationRuntime();
  const actions = runtime.status === "ready" ? runtime.householdActions : undefined;
  const canMutate = useCapability("householdMutations");

  async function accept() {
    if (!actions) return;
    await actions.acceptJoinRequest(request.joinRequestId);
    toast.success(`${request.requesterName} was added to the household.`);
  }

  async function reject() {
    if (!actions) return;
    await actions.rejectJoinRequest(request.joinRequestId);
    toast.success(`${request.requesterName}'s request was rejected.`);
  }

  return (
    <li className="flex flex-col gap-4 border-b py-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-words font-medium">{request.requesterName}</p>
        <p className="mt-1 text-caption text-text-secondary"><time dateTime={request.createdAt.slice(0, 10)}>Requested {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(request.createdAt))}</time></p>
      </div>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          confirmLabel="Accept request"
          description="They will gain access to the household after acceptance."
          errorMessage="The request, requester eligibility, or Household leadership changed. Review the current status before confirming again."
          onConfirm={accept}
          title={`Accept ${request.requesterName} into ${householdName}?`}
          trigger={<Button className="min-h-11 min-w-20" disabled={!canMutate} size="sm">Accept</Button>}
        />
        <ConfirmDialog
          confirmLabel="Reject request"
          description="The request will be closed and retained in household history."
          destructive
          errorMessage="The request or Household leadership changed. Review the current status before confirming again."
          onConfirm={reject}
          title={`Reject ${request.requesterName}'s join request?`}
          trigger={<Button className="min-h-11 min-w-20" disabled={!canMutate} size="sm" variant="outline">Reject</Button>}
        />
      </div>
    </li>
  );
}

interface DialogState {
  readonly action: HouseholdDialogAction;
  readonly memberId?: HouseholdMemberView["memberId"];
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
}

function ActiveHouseholdView({
  page,
  joinRequests,
}: Readonly<{
  page: ActiveHouseholdPageView;
  joinRequests: readonly LeaderJoinRequestView[];
}>) {
  const runtime = useApplicationRuntime();
  const actions = runtime.status === "ready" ? runtime.householdActions : undefined;
  const canMutate = useCapability("householdMutations");
  const leaveRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<DialogState>();
  const [renameOpen, setRenameOpen] = useState(false);
  const selectedMember = dialog?.memberId
    ? page.members.find((member) => member.memberId === dialog.memberId)
    : undefined;

  function openMemberAction(
    action: MemberManagementAction,
    memberId: HouseholdMemberView["memberId"],
    triggerRef: RefObject<HTMLButtonElement | null>,
  ) {
    setDialog({ action, memberId, restoreFocusRef: triggerRef });
  }

  async function confirmAction() {
    if (!actions || !dialog) return;
    if (dialog.action === "leave") {
      await actions.leaveHousehold();
      toast.success("You left the household. Your financial history was preserved.");
    } else if (dialog.action === "remove" && selectedMember) {
      await actions.removeMember(selectedMember.memberId);
      toast.success(`${selectedMember.displayName} was removed from the household.`);
    } else if (dialog.action === "transfer" && selectedMember) {
      await actions.transferLeadership(selectedMember.memberId);
      toast.success(`${selectedMember.displayName} is now the House Leader.`);
    } else if (dialog.action === "delete") {
      await actions.deleteHousehold();
      toast.success("The household was closed. Historical financial records were preserved.");
    }
  }

  return (
    <div className="grid max-w-4xl gap-6">
      <Surface padding="large">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <HouseholdIdentity name={page.household.name} code={page.household.code} />
          {page.viewerRole === "leader" ? (
            <Button
              disabled={!canMutate}
              onClick={() => setRenameOpen(true)}
              ref={renameRef}
              size="sm"
              variant="outline"
            >
              <Pencil aria-hidden="true" /> Rename
            </Button>
          ) : null}
        </div>
      </Surface>

      <Surface padding="large">
        <div className="flex items-center gap-2">
          <Crown aria-hidden="true" className="size-5" />
          <h2 className="panel-title">House Leader</h2>
        </div>
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-secondary/45 p-4">
          <MemberAvatar className="size-11" displayName={page.leader.displayName} />
          <div className="min-w-0">
            <p className="break-words font-medium">{page.leader.displayName}</p>
            <p className="text-caption text-text-secondary">Leader</p>
          </div>
        </div>
      </Surface>

      <Surface padding="large">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" className="size-5" />
          <h2 className="panel-title">Members</h2>
        </div>
        <p className="mt-2 text-body text-text-secondary">Current active household members.</p>
        <HouseholdMemberList
          actionsDisabled={!canMutate}
          members={page.members}
          onAction={openMemberAction}
          viewerRole={page.viewerRole}
        />
        <CapabilityNotice active={!canMutate} />
      </Surface>

      {page.viewerRole === "leader" ? (
        <Surface padding="large">
          <h2 className="panel-title">Join requests</h2>
          <p className="mt-2 text-body text-text-secondary">Review people waiting to join this household.</p>
          {joinRequests.length ? (
            <ul className="mt-4" aria-label="Pending join requests">
              {joinRequests.map((request) => (
                <LeaderRequestRow
                  householdName={page.household.name}
                  key={request.joinRequestId}
                  request={request}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-6 rounded-lg bg-secondary p-4 text-body text-text-secondary">No Pending join requests.</p>
          )}
        </Surface>
      ) : null}

      <Surface padding="large">
        <h2 className="panel-title">Household management</h2>
        <p className="mt-2 text-body text-text-secondary">Leave only after your exact balance and Pending settlements are clear.</p>
        <Button
          className="mt-5 w-full sm:w-fit"
          disabled={!page.leave.eligible || !canMutate}
          onClick={() => setDialog({ action: "leave", restoreFocusRef: leaveRef })}
          ref={leaveRef}
          variant="outline"
        >
          <LogOut aria-hidden="true" /> Leave Household
        </Button>
        <HouseholdActionExplanations preview={page.leave} />
      </Surface>

      {page.viewerRole === "leader" ? (
        <Surface className="border-danger/25" padding="large">
          <h2 className="panel-title text-danger">Danger zone</h2>
          <p className="mt-2 text-body text-text-secondary">Close this household for every active member while preserving historical financial records.</p>
          <Button
            className="mt-5 w-full sm:w-fit"
            disabled={!page.deleteHousehold.eligible || !canMutate}
            onClick={() => setDialog({ action: "delete", restoreFocusRef: deleteRef })}
            ref={deleteRef}
            variant="destructive"
          >
            <Trash2 aria-hidden="true" /> Delete Household
          </Button>
          <HouseholdActionExplanations preview={page.deleteHousehold} />
        </Surface>
      ) : null}

      {dialog && (dialog.action === "leave" || dialog.action === "delete" || selectedMember) ? (
        <HouseholdManagementDialog
          action={dialog.action}
          householdName={page.household.name}
          memberName={selectedMember?.displayName}
          onConfirm={confirmAction}
          onOpenChange={(open) => { if (!open) setDialog(undefined); }}
          open
          restoreFocusRef={dialog.restoreFocusRef}
        />
      ) : null}

      {renameOpen && actions ? (
        <RenameHouseholdDialog
          currentName={page.household.name}
          onOpenChange={(open) => { if (!open) setRenameOpen(false); }}
          onSubmit={async (name) => {
            await actions.renameHousehold(name);
            toast.success("The House name was updated.");
          }}
          restoreFocusRef={renameRef}
        />
      ) : null}
    </div>
  );
}

export function HouseholdPageClient() {
  const runtime = useApplicationRuntime();
  const canMutate = useCapability("householdMutations");

  if (runtime.status === "loading") {
    return <PageContainer><LoadingState label="Loading household" /></PageContainer>;
  }
  if (runtime.status === "error") {
    return <PageContainer><ErrorState description={runtime.message} onRetry={runtime.retry} title="Household could not be loaded" /></PageContainer>;
  }

  const household = runtime.household;
  const actions = runtime.householdActions;

  async function cancelRequest() {
    if (household.status !== "pending-request") return;
    await actions.cancelJoinRequest(household.request.joinRequestId);
    toast.success("Join request cancelled.");
  }

  return (
    <PageContainer className="grid gap-6">
      <PageHeader
        description={household.status === "no-household" ? "You aren't part of a household yet." : undefined}
        title="Household"
      />

      {household.status === "no-household" ? <NoHouseholdState /> : null}

      {household.status === "pending-request" ? (
        <Surface className="max-w-2xl" padding="large">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="break-words text-h3">{household.request.household.name}</p>
              <p className="mt-1 font-mono text-body tabular-nums text-text-secondary">House code {household.request.household.code}</p>
            </div>
            <StatusBadge tone="warning">Pending</StatusBadge>
          </div>
          <p className="mt-6 max-w-xl text-body text-text-secondary">
            A household leader needs to accept your request before you can access household information.
          </p>
          <div className="mt-6">
            <ConfirmDialog
              confirmLabel="Cancel request"
              description="You can create a household or submit another request afterward."
              destructive
              onConfirm={cancelRequest}
              title="Cancel this join request?"
              trigger={<Button disabled={!canMutate} variant="outline">Cancel Request</Button>}
            />
            <CapabilityNotice active={!canMutate} />
          </div>
        </Surface>
      ) : null}

      {household.status === "active-member" || household.status === "active-leader" ? (
        <ActiveHouseholdView
          joinRequests={household.status === "active-leader" ? household.joinRequests : []}
          key={`${runtime.session.userId}:${household.household.householdId}`}
          page={household.page}
        />
      ) : null}
    </PageContainer>
  );
}
