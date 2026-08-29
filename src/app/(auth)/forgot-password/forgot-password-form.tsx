"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthForm } from "../use-auth-form";

export function ForgotPasswordForm() {
  const { pending, error, submit } = useAuthForm();
  const [sent, setSent] = useState(false);
  if (sent) {
    return <p className="text-body text-text-secondary" role="status">If an account exists for that email, a recovery link has been sent. The link expires in one hour.</p>;
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void submit({ email: data.get("email") }, "/api/auth/password/forgot", () => setSent(true));
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="forgot-email">Email</Label>
        <Input id="forgot-email" name="email" type="email" autoComplete="email" required />
      </div>
      {error ? <p className="text-caption text-danger" role="alert">{error}</p> : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Sending…" : "Send recovery link"}</Button>
    </form>
  );
}
