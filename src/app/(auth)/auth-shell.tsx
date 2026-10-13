import Link from "next/link";
import { House } from "lucide-react";
import type { ReactNode } from "react";

export function AuthShell({ title, description, children }: Readonly<{ title: string; description: string; children: ReactNode }>) {
  return (
    <main className="journey-auth-shell grid min-h-dvh place-items-center px-4 py-24">
      <div className="journey-auth-brand"><House aria-hidden="true" className="size-7" strokeWidth={1.8} /><span>House Finance Tracker</span></div>
      <div className="journey-auth-group w-full max-w-[560px]">
      <div className="journey-auth-panel">
        <div className="mb-8">
          <h1 className="page-title">{title}</h1>
          <p className="mt-1 text-body text-text-secondary">{description}</p>
        </div>
        {children}
        <p className="mt-6 text-center text-caption text-text-muted">
          <Link href="/" className="underline underline-offset-4 hover:text-text-secondary">Back to home</Link>
        </p>
      </div>
      </div>
    </main>
  );
}
