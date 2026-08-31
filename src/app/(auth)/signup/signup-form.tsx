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
import { PasswordField } from "@/components/ui/password-field";
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
      <PasswordField
        id="signup-password"
        label="Password"
        autoComplete="new-password"
        required
        error={form.formState.errors.password?.message}
        {...form.register("password")}
      />
      <PasswordField
        id="signup-confirm-password"
        label="Confirm Password"
        autoComplete="new-password"
        required
        error={form.formState.errors.confirmPassword?.message}
        {...form.register("confirmPassword")}
      />
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
