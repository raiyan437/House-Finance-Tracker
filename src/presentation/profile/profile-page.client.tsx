"use client";

import { House, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { useCapability } from "@/presentation/runtime/capability-gate.client";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { Surface } from "@/presentation/components/surface";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { PasswordUpdateForm } from "./password-update-form.client";
import { DisplayNameForm } from "./display-name-form.client";

export function ProfilePageClient() {
  const runtime = useApplicationRuntime();
  const profileEditingAvailable = useCapability("profileMutations");

  if (runtime.status === "loading") {
    return (
      <PageContainer>
        <PageHeader title="Profile" description="Your local account and household membership." />
        <Surface className="mt-6 min-h-56 animate-pulse" aria-label="Loading profile">
          <p className="sr-only" role="status">Loading profile…</p>
        </Surface>
      </PageContainer>
    );
  }

  if (runtime.status === "error") {
    return (
      <PageContainer>
        <PageHeader title="Profile" description="Your local account and household membership." />
        <Surface className="mt-6" aria-labelledby="profile-error-heading">
          <h2 className="panel-title" id="profile-error-heading">Profile unavailable</h2>
          <p className="mt-2 text-sm text-text-secondary" role="alert">{runtime.message}</p>
        </Surface>
      </PageContainer>
    );
  }

  const { session } = runtime;
  const hasHousehold = Boolean(session.householdName);
  const passwordUpdateAvailable = Boolean(runtime.signOut);

  return (
    <PageContainer>
      <PageHeader
        title="Profile"
        description="Your local account and current household membership."
      />

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <Surface padding="large" aria-labelledby="profile-account-heading">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <MemberAvatar
              className="size-20 shrink-0 text-xl font-semibold ring-4 ring-brand-soft"
              displayName={session.displayName}
            />
            <div className="min-w-0">
              <p className="compact-caption text-text-muted">Account</p>
              <h2 className="mt-1 truncate text-h2" id="profile-account-heading">
                {session.displayName}
              </h2>
              <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-text-secondary">
                <Mail aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{session.displayEmail}</span>
              </p>
            </div>
          </div>

          <dl className="mt-7 grid gap-3 border-t pt-5 sm:grid-cols-2">
            <div className="rounded-xl bg-secondary p-4">
              <dt className="compact-caption text-text-muted">Display name</dt>
              <dd className="mt-1 break-words text-sm font-semibold">{session.displayName}</dd>
            </div>
            <div className="rounded-xl bg-secondary p-4">
              <dt className="compact-caption text-text-muted">Email</dt>
              <dd className="mt-1 break-all text-sm font-semibold">{session.displayEmail}</dd>
            </div>
          </dl>
        </Surface>

        <Surface padding="large" aria-labelledby="profile-household-heading">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand-soft">
            {hasHousehold ? <House aria-hidden="true" className="size-5" /> : <UserRound aria-hidden="true" className="size-5" />}
          </div>
          <p className="mt-5 compact-caption text-text-muted">Current household</p>
          <h2 className="mt-1 text-h3" id="profile-household-heading">
            {session.householdName ?? "No household"}
          </h2>
          <div className="mt-4 flex min-h-11 items-center gap-3 rounded-xl border bg-secondary px-4 py-3">
            <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-text-secondary" />
            <div>
              <p className="compact-caption text-text-muted">Role</p>
              <p className="text-sm font-semibold">{hasHousehold ? session.roleLabel : "No household"}</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-text-muted">Your sign-in email is fixed for this approved account.</p>
        </Surface>
      </div>

      {profileEditingAvailable ? (
        <Surface className="mt-4" padding="large" aria-labelledby="profile-display-name-heading">
          <h2 className="panel-title" id="profile-display-name-heading">Display Name</h2>
          <p className="mt-1 text-sm text-text-secondary">Change the name shown in current Household views. Historical snapshots remain unchanged.</p>
          <DisplayNameForm />
        </Surface>
      ) : null}

      {passwordUpdateAvailable ? (
        <Surface className="mt-4" padding="large" aria-labelledby="profile-password-heading">
          <h2 className="panel-title" id="profile-password-heading">Password</h2>
          <p className="mt-1 text-sm text-text-secondary">Update your password using your current password. You will sign in again afterward.</p>
          <PasswordUpdateForm />
        </Surface>
      ) : null}
    </PageContainer>
  );
}
