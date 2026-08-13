"use client";

import Link from "next/link";
import { ArrowRight, House, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/presentation/components/confirm-dialog";
import { ErrorState, LoadingState } from "@/presentation/components/async-state";
import { StatusBadge } from "@/presentation/components/status-badge";
import { Surface } from "@/presentation/components/surface";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import type { LeaderJoinRequestView } from "@/application/services/application-services";

function HouseholdIdentity({ name, code }: Readonly<{ name: string; code: string }>) {
  return (
    <div className="min-w-0">
      <p className="break-words text-h3">{name}</p>
      <p className="mt-1 font-mono text-body tabular-nums text-text-secondary">House code {code}</p>
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
        <h2 className="mt-6 text-h3">Create a Household</h2>
        <p className="mt-2 flex-1 text-body text-text-secondary">Start a household and become its leader.</p>
        <Button asChild className="mt-6 w-full sm:w-fit">
          <Link href="/household/create">Create a Household <ArrowRight aria-hidden="true" /></Link>
        </Button>
      </Surface>
      <Surface className="flex min-h-56 flex-col">
        <span className="flex size-11 items-center justify-center rounded-full bg-secondary">
          <UserPlus aria-hidden="true" className="size-5" />
        </span>
        <h2 className="mt-6 text-h3">Join a Household</h2>
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
        <p className="mt-1 text-caption text-text-secondary">Requested {request.createdAt.slice(0, 10)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          confirmLabel="Accept request"
          description="They will gain access to the household after acceptance."
          onConfirm={accept}
          title={`Accept ${request.requesterName} into ${householdName}?`}
          trigger={<Button size="sm">Accept</Button>}
        />
        <ConfirmDialog
          confirmLabel="Reject request"
          description="The request will be closed and retained in household history."
          destructive
          onConfirm={reject}
          title={`Reject ${request.requesterName}'s join request?`}
          trigger={<Button size="sm" variant="outline">Reject</Button>}
        />
      </div>
    </li>
  );
}

export function HouseholdPageClient() {
  const runtime = useApplicationRuntime();

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
    <PageContainer className="grid gap-8">
      <PageHeader
        description={household.status === "no-household" ? "You aren't part of a household yet." : undefined}
        title="Household"
      />

      {household.status === "no-household" ? <NoHouseholdState /> : null}

      {household.status === "pending-request" ? (
        <Surface className="max-w-2xl" padding="large">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <HouseholdIdentity name={household.request.household.name} code={household.request.household.code} />
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
              trigger={<Button variant="outline">Cancel Request</Button>}
            />
          </div>
        </Surface>
      ) : null}

      {household.status === "active-member" || household.status === "active-leader" ? (
        <Surface className="max-w-3xl" padding="large">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <HouseholdIdentity name={household.household.name} code={household.household.code} />
            <StatusBadge tone="success">{household.status === "active-leader" ? "Leader" : "Member"}</StatusBadge>
          </div>
        </Surface>
      ) : null}

      {household.status === "active-leader" ? (
        <Surface className="max-w-3xl" padding="large">
          <div>
            <h2 className="text-h2">Join requests</h2>
            <p className="mt-2 text-body text-text-secondary">Review people waiting to join this household.</p>
          </div>
          {household.joinRequests.length ? (
            <ul className="mt-4" aria-label="Pending join requests">
              {household.joinRequests.map((request) => <LeaderRequestRow householdName={household.household.name} key={request.joinRequestId} request={request} />)}
            </ul>
          ) : (
            <p className="mt-6 rounded-lg bg-secondary p-4 text-body text-text-secondary">No Pending join requests.</p>
          )}
        </Surface>
      ) : null}
    </PageContainer>
  );
}
