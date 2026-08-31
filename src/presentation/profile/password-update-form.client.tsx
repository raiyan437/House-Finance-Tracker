"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required.").max(256, "Current password is too long."),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(256, "New password must be no more than 256 characters."),
  confirmPassword: z.string().min(1, "Confirm your new password."),
}).superRefine((values, context) => {
  if (values.newPassword !== values.confirmPassword) {
    context.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match." });
  }
  if (values.currentPassword && values.currentPassword === values.newPassword) {
    context.addIssue({ code: "custom", path: ["newPassword"], message: "New password must be different from current password." });
  }
});

type PasswordValues = z.infer<typeof passwordSchema>;

export function PasswordUpdateForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string>();
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  return (
    <form
      className="mt-5 grid w-full max-w-xl gap-4"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        setServerError(undefined);
        try {
          const response = await fetch("/api/auth/password", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(values),
          });
          const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
          if (!response.ok) {
            if (response.status === 401) {
              router.replace("/login");
              return;
            }
            setServerError(typeof payload.error === "string" ? payload.error : "Password could not be updated. Please try again.");
            form.setFocus("currentPassword");
            return;
          }
          router.replace("/login?passwordUpdated=1");
          router.refresh();
        } catch {
          setServerError("The service is temporarily unavailable. Please try again.");
          form.setFocus("currentPassword");
        }
      })}
    >
      <PasswordField
        id="profile-current-password"
        label="Current Password"
        autoComplete="current-password"
        error={form.formState.errors.currentPassword?.message}
        {...form.register("currentPassword")}
      />
      <PasswordField
        id="profile-new-password"
        label="New Password"
        autoComplete="new-password"
        error={form.formState.errors.newPassword?.message}
        {...form.register("newPassword")}
      />
      <PasswordField
        id="profile-confirm-password"
        label="Confirm New Password"
        autoComplete="new-password"
        error={form.formState.errors.confirmPassword?.message}
        {...form.register("confirmPassword")}
      />
      {serverError ? <p className="text-caption text-danger" role="alert">{serverError}</p> : null}
      <div>
        <Button type="submit" disabled={form.formState.isSubmitting} aria-busy={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Updating password…" : "Update Password"}
        </Button>
      </div>
    </form>
  );
}
