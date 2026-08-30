"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthForm } from "../use-auth-form";

const signupSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(256, "Password must be no more than 256 characters."),
  confirmPassword: z.string().min(1, "Confirm your password."),
}).refine((values) => values.password === values.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

type SignupValues = z.infer<typeof signupSchema>;

export function SignupForm() {
  const router = useRouter();
  const { pending, error, submit } = useAuthForm();
  const [accountExists, setAccountExists] = useState(false);
  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) => {
        setAccountExists(false);
        void submit(values, "/api/auth/signup", () => router.push("/dashboard"), (payload) => {
          setAccountExists(payload.code === "ACCOUNT_EXISTS");
          form.setFocus("email");
        });
      })}
    >
      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(form.formState.errors.email)}
          aria-describedby={form.formState.errors.email ? "signup-email-error" : undefined}
          {...form.register("email")}
        />
        {form.formState.errors.email ? <p id="signup-email-error" className="text-caption text-danger">{form.formState.errors.email.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(form.formState.errors.password)}
          aria-describedby={form.formState.errors.password ? "signup-password-error" : undefined}
          {...form.register("password")}
        />
        {form.formState.errors.password ? <p id="signup-password-error" className="text-caption text-danger">{form.formState.errors.password.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-confirm-password">Confirm Password</Label>
        <Input
          id="signup-confirm-password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(form.formState.errors.confirmPassword)}
          aria-describedby={form.formState.errors.confirmPassword ? "signup-confirm-password-error" : undefined}
          {...form.register("confirmPassword")}
        />
        {form.formState.errors.confirmPassword ? <p id="signup-confirm-password-error" className="text-caption text-danger">{form.formState.errors.confirmPassword.message}</p> : null}
      </div>
      {error ? <p className="text-caption text-danger" role="alert">{error}</p> : null}
      {accountExists ? (
        <p className="text-caption text-text-secondary">
          <Link className="underline underline-offset-4" href="/login">Sign in</Link>
          {" or "}
          <Link className="underline underline-offset-4" href="/forgot-password">reset your password</Link>.
        </p>
      ) : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Creating account…" : "Create Account"}</Button>
    </form>
  );
}
