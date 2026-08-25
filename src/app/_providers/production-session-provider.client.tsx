"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Surface } from "@/presentation/components/surface";

export type ProductionSessionStatus = "loading" | "anonymous" | "authenticated" | "provider-unavailable";

export interface ProductionSessionState {
  readonly status: ProductionSessionStatus;
  readonly email?: string;
}

const ProductionSessionContext = createContext<Readonly<{ state: ProductionSessionState; refresh: () => void }> | undefined>(undefined);

export function useProductionSession(): { state: ProductionSessionState; refresh: () => void } {
  const context = useContext(ProductionSessionContext);
  if (!context) throw new Error("Production session provider is missing.");
  return context;
}

function SessionSkeleton() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background" role="status" aria-label="Loading">
      <div className="grid gap-3 text-center text-body text-text-muted">Loading…</div>
    </main>
  );
}

function AnonymousRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.push("/login");
  }, [router]);
  return <SessionSkeleton />;
}

function AuthenticatedMilestone({ email, onLogout, logoutWarning }: Readonly<{ email?: string; onLogout: () => void; logoutWarning?: string }>) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <Surface padding="canonical" className="w-full max-w-md text-center">
        <h1 className="text-h2 font-semibold">Signed in{email ? ` as ${email}` : ""}</h1>
        <p className="mt-2 text-body text-text-secondary">
          Authentication is active. Household features are being migrated to the production backend and will appear in an upcoming update.
        </p>
        {logoutWarning ? (
          <p className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-foreground" role="status">{logoutWarning}</p>
        ) : null}
        <Button className="mx-auto mt-6" variant="outline" onClick={onLogout}>Log Out</Button>
      </Surface>
    </main>
  );
}

export function ProductionSessionProvider() {
  const router = useRouter();
  const [state, setState] = useState<ProductionSessionState>({ status: "loading" });
  const [logoutWarning, setLogoutWarning] = useState<string>();

  const refresh = useCallback(() => {
    void fetch("/api/session")
      .then(async (response) => {
        if (response.status === 503) return { status: "provider-unavailable" } as ProductionSessionState;
        return (await response.json()) as Partial<ProductionSessionState> & { state?: ProductionSessionStatus };
      })
      .then((next) => setState({ status: next.status ?? next.state ?? "provider-unavailable", email: next.email }))
      .catch(() => setState({ status: "provider-unavailable" }));
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const logout = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { warning?: string };
        setLogoutWarning(payload.warning);
        setState({ status: "anonymous" });
        router.push("/login");
      })
      .catch(() => {
        setState({ status: "anonymous" });
        setLogoutWarning("Signed out on this device. Remote session revocation could not be confirmed.");
        router.push("/login");
      });
  }, [router]);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);

  if (state.status === "loading") return <SessionSkeleton />;
  if (state.status === "anonymous") return <AnonymousRedirect />;
  if (state.status === "provider-unavailable") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-4 py-10" role="status">
        <Surface padding="canonical" className="max-w-md text-center">
          <h1 className="text-h2 font-semibold">Service temporarily unavailable</h1>
          <p className="mt-2 text-body text-text-secondary">We could not verify your sign-in right now. Your data is safe — please retry shortly.</p>
          <Button className="mx-auto mt-6" onClick={refresh}>Retry</Button>
        </Surface>
      </main>
    );
  }
  return (
    <ProductionSessionContext.Provider value={value}>
      <AuthenticatedMilestone email={state.email} onLogout={logout} logoutWarning={logoutWarning} />
    </ProductionSessionContext.Provider>
  );
}
