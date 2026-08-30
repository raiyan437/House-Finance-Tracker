"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      className="mt-5 grid gap-4 sm:grid-cols-2"
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
        registration={form.register("currentPassword")}
        className="sm:col-span-2"
      />
      <PasswordField
        id="profile-new-password"
        label="New Password"
        autoComplete="new-password"
        error={form.formState.errors.newPassword?.message}
        registration={form.register("newPassword")}
      />
      <PasswordField
        id="profile-confirm-password"
        label="Confirm New Password"
        autoComplete="new-password"
        error={form.formState.errors.confirmPassword?.message}
        registration={form.register("confirmPassword")}
      />
      {serverError ? <p className="text-caption text-danger sm:col-span-2" role="alert">{serverError}</p> : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={form.formState.isSubmitting} aria-busy={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Updating password…" : "Update Password"}
        </Button>
      </div>
    </form>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  error,
  registration,
  className,
}: Readonly<{
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  registration: UseFormRegisterReturn;
  className?: string;
}>) {
  const errorId = `${id}-error`;
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" autoComplete={autoComplete} required aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...registration} />
      {error ? <p id={errorId} className="text-caption text-danger">{error}</p> : null}
    </div>
  );
}
