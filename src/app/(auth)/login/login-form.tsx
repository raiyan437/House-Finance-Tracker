"use client";

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PasswordField } from "@/components/ui/password-field";
import { Button } from "@/components/ui/button";
import { useAuthForm } from "../use-auth-form";

export function LoginForm() {
  const router = useRouter();
  const { pending, error, submit } = useAuthForm();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void submit({ email: data.get("email"), password: data.get("password") }, "/api/auth/login", () => {
          router.push("/dashboard");
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input id="login-email" name="email" type="email" autoComplete="username" required />
      </div>
      <PasswordField id="login-password" name="password" label="Password" autoComplete="current-password" required />
      {error ? <p className="text-caption text-danger" role="alert">{error}</p> : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Signing in…" : "Sign In"}</Button>
    </form>
  );
}
