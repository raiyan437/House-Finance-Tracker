const foundationChecks = [
  "Next.js App Router and strict TypeScript",
  "Tailwind CSS and shadcn/ui foundation",
  "Vitest, React Testing Library, and Playwright",
  "Layer boundaries ready for local-first implementation",
] as const;

export default function Home() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12 sm:px-6">
      <section
        aria-labelledby="foundation-title"
        className="w-full max-w-2xl rounded-[var(--radius-card)] border bg-card p-6 shadow-[var(--shadow-card)] sm:p-10"
      >
        <p className="mb-3 text-sm font-medium text-muted-foreground">
          Phase 1
        </p>
        <h1
          id="foundation-title"
          className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          House Finance Tracker
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          The local project foundation is ready. Product features and backend
          integration have not started.
        </p>

        <ul
          aria-label="Foundation status"
          className="mt-8 grid gap-3 text-sm text-foreground sm:grid-cols-2"
        >
          {foundationChecks.map((check) => (
            <li
              key={check}
              className="rounded-xl border bg-secondary px-4 py-3"
            >
              {check}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
