import { House, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function StandalonePage({ title, description, icon: Icon, code, action, children, ...props }: Readonly<{
  title: string;
  description: string;
  icon?: LucideIcon;
  code?: string;
  action?: ReactNode;
  children?: ReactNode;
}> & React.ComponentProps<"main">) {
  return (
    <main className="journey-standalone-shell" {...props}>
      <div className="journey-auth-brand"><House aria-hidden="true" className="size-7" strokeWidth={1.8} /><span>House Finance Tracker</span></div>
      <div className="journey-standalone-group">
        <section className="journey-standalone-panel">
          {Icon || code ? <span aria-hidden="true" className="journey-state-symbol">{code ?? (Icon ? <Icon className="size-7" /> : null)}</span> : null}
          <h1 className="page-title">{title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-text-secondary">{description}</p>
          {children}
          {action ? <div className="mt-7 flex flex-wrap justify-center gap-3">{action}</div> : null}
        </section>
      </div>
    </main>
  );
}
