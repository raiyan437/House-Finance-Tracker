"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApplicationError } from "@/application/errors/application-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommandId } from "@/domain/shared/identifiers";
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from "@/domain/records/domain-records";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";

const displayNameSchema = z.object({
  displayName: z.string().transform((value) => value.trim()).pipe(
    z.string()
      .min(1, "Display Name is required.")
      .max(PROFILE_DISPLAY_NAME_MAX_LENGTH, "Display name must be 20 characters or fewer."),
  ),
});

type DisplayNameValues = z.input<typeof displayNameSchema>;

export function DisplayNameForm() {
  const runtime = useApplicationRuntime();
  if (runtime.status !== "ready") return null;
  return <ReadyDisplayNameForm key={runtime.session.userId} runtime={runtime} />;
}

function ReadyDisplayNameForm({ runtime }: Readonly<{ runtime: Extract<ReturnType<typeof useApplicationRuntime>, { status: "ready" }> }>) {
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string }>();
  const [retry, setRetry] = useState<{ intent: string; commandId: CommandId }>();
  const form = useForm<DisplayNameValues>({
    resolver: zodResolver(displayNameSchema),
    defaultValues: { displayName: runtime.session.displayName },
  });
  useEffect(() => {
    form.reset({ displayName: runtime.session.displayName });
  }, [form, runtime.session.displayName, runtime.session.profileVersion]);

  return (
    <form
      className="mt-5 min-w-0"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        const displayName = values.displayName.trim();
        setStatus(undefined);
        const commandId = retry?.intent === displayName
          ? retry.commandId
          : crypto.randomUUID() as CommandId;
        setRetry({ intent: displayName, commandId });
        try {
          await runtime.profileActions.updateDisplayName(displayName, runtime.session.profileVersion, commandId);
          setRetry(undefined);
          form.reset({ displayName });
          setStatus({ kind: "success", message: "Display Name updated successfully." });
        } catch (error) {
          const conflict = error instanceof ApplicationError && error.code === "PROFILE_VERSION_CONFLICT";
          setStatus({
            kind: "error",
            message: conflict
              ? "Your Profile changed in another session. The latest Display Name has been reloaded; review it and try again."
              : error instanceof ApplicationError ? error.message : "Display Name could not be updated. Please try again.",
          });
          form.setFocus("displayName");
        }
      })}
    >
      <div className="min-w-0 space-y-2">
        <Label htmlFor="profile-display-name">Display Name</Label>
        <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Input
            id="profile-display-name"
            autoComplete="name"
            maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH}
            required
            aria-invalid={Boolean(form.formState.errors.displayName)}
            aria-describedby={form.formState.errors.displayName ? "profile-display-name-error" : "profile-display-name-help"}
            {...form.register("displayName")}
          />
          <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={form.formState.isSubmitting} aria-busy={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving Display Name…" : "Save Display Name"}
          </Button>
        </div>
        {form.formState.errors.displayName ? (
          <p id="profile-display-name-error" className="text-caption text-danger" role="alert">
            {form.formState.errors.displayName.message}
          </p>
        ) : (
          <p id="profile-display-name-help" className="text-caption text-text-muted">Shown to authorized members where current identity is used.</p>
        )}
      </div>
      {status ? (
        <p className={status.kind === "error" ? "mt-4 text-caption text-danger" : "mt-4 text-caption text-success"} role={status.kind === "error" ? "alert" : "status"}>
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
