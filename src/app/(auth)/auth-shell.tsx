import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

export function AuthShell({ title, description, children }: Readonly<{ title: string; description: string; children: ReactNode }>) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Image
            alt=""
            aria-hidden="true"
            className="mx-auto mb-4 size-12 rounded-[14px]"
            height={48}
            priority
            src="/house-finance-logo.png"
            width={48}
          />
          <h1 className="text-h2 font-semibold">{title}</h1>
          <p className="mt-1 text-body text-text-secondary">{description}</p>
        </div>
        {children}
        <p className="mt-6 text-center text-caption text-text-muted">
          <Link href="/" className="underline underline-offset-4 hover:text-text-secondary">Back to home</Link>
        </p>
      </div>
    </main>
  );
}
