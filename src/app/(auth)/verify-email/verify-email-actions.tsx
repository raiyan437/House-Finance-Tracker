"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthForm } from "../use-auth-form";

export function VerifyEmailActions() {
  const router = useRouter();
  const params = useSearchParams();
  const userId = params.get("userId");
  const secret = params.get("secret");
  const linkIsIncomplete = Boolean(userId) !== Boolean(secret);
  const [sent, setSent] = useState(false);
  const { pending, error, submit } = useAuthForm();

  return (
    <div className="grid gap-4">
      {sent ? <p role="status" className="text-caption text-text-secondary">Verification email sent. Check your inbox and spam folder.</p> : null}
      {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
      {!error && !sent && params.get("delivery") === "failed" ? (
        <p role="status" className="text-caption text-text-secondary">Your account was created. Request a verification email below.</p>
      ) : null}
      {linkIsIncomplete ? <p role="alert" className="text-caption text-danger">This verification link is incomplete. Request a new link.</p> : null}
      {userId && secret ? (
        <Button type="button" disabled={pending} onClick={() => {
          setSent(false);
          void submit({ action: "confirm", userId, secret }, "/api/auth/verification", () => router.replace("/dashboard"));
        }}>Confirm email</Button>
      ) : null}
      <Button type="button" variant={userId && secret ? "outline" : "default"} disabled={pending} onClick={() => {
        setSent(false);
        void submit({ action: "send" }, "/api/auth/verification", (payload) => {
          if (payload.verified === true) router.replace("/dashboard");
          else if (payload.sent === true) setSent(true);
        });
      }}>Send a new link</Button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/login" className="text-caption font-semibold underline underline-offset-4">Sign in</Link>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => {
          setSent(false);
          void submit({}, "/api/auth/logout", () => router.replace("/login"));
        }}>Sign out</Button>
      </div>
    </div>
  );
}
