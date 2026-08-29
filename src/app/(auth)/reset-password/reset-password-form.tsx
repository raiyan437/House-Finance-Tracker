"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthForm } from "../use-auth-form";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const userId = params.get("userId") ?? "";
  const secret = params.get("secret") ?? "";
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const { pending, error, submit } = useAuthForm();

  if (done) {
    return (
      <p className="text-body text-success" role="status">
        Password updated. Continue to sign in with your new password.
      </p>
    );
  }
  if (!userId || !secret) {
    return (
      <p className="text-body text-danger" role="alert">
        This reset link is incomplete. Request a new recovery email.
      </p>
    );
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (data.get("password") !== data.get("confirm")) {
          setMismatch(true);
          return;
        }
        setMismatch(false);
        void submit({ userId, secret, password: data.get("password") }, "/api/auth/password/reset", () => setDone(true));
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="reset-password">New password</Label>
        <Input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reset-confirm">Confirm password</Label>
        <Input id="reset-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      {mismatch ? <p className="text-caption text-danger" role="alert">Passwords do not match.</p> : null}
      {error ? <p className="text-caption text-danger" role="alert">{error}</p> : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Updating…" : "Set new password"}</Button>
    </form>
  );
}
