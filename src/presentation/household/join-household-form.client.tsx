"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { JoinableHouseholdView } from "@/application/services/application-services";
import {
  joinHouseholdSchema,
  type JoinHouseholdInput,
  type JoinHouseholdValues,
} from "@/application/validation/household-onboarding.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/presentation/components/async-state";
import { Surface } from "@/presentation/components/surface";
import { FormField } from "@/presentation/forms/form-field";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";

export function JoinHouseholdForm() {
  const router = useRouter();
  const runtime = useApplicationRuntime();
  const [household, setHousehold] = useState<JoinableHouseholdView>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const form = useForm<JoinHouseholdInput, unknown, JoinHouseholdValues>({
    resolver: zodResolver(joinHouseholdSchema),
    defaultValues: { code: "" },
  });
  const code = useWatch({ control: form.control, name: "code" });
  const matchedHousehold = household?.code === code ? household : undefined;

  const mustReturn = runtime.status === "ready" && runtime.household.status !== "no-household" && !sending;
  useEffect(() => {
    if (mustReturn) router.replace("/household");
  }, [mustReturn, router]);

  if (runtime.status === "loading" || mustReturn) {
    return <PageContainer><LoadingState label={mustReturn ? "Returning to household" : "Loading household onboarding"} /></PageContainer>;
  }
  if (runtime.status === "error") {
    return <PageContainer><ErrorState description={runtime.message} onRetry={runtime.retry} title="Onboarding could not be loaded" /></PageContainer>;
  }
  const actions = runtime.householdActions;

  async function findHousehold(values: JoinHouseholdValues) {
    form.clearErrors("root");
    setSendError(undefined);
    try {
      setHousehold(await actions.findHousehold(values.code));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The household could not be found.";
      form.setError("code", { message });
      setHousehold(undefined);
    }
  }

  async function sendRequest() {
    if (!matchedHousehold || sending) return;
    setSending(true);
    setSendError(undefined);
    try {
      await actions.requestToJoin(matchedHousehold.householdId);
      toast.success("Join request sent.");
      router.replace("/household");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "The join request could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <PageContainer className="grid gap-6">
      <PageHeader description="Enter the household's nine-digit code, then confirm where you want to send the request." title="Join Household" />
      <Surface className="max-w-2xl" padding="large">
        <form className="grid gap-6" noValidate onSubmit={form.handleSubmit(findHousehold)}>
          <FormField description="Exactly 9 digits." error={form.formState.errors.code?.message} label="House Code" required>
            <Input
              autoComplete="off"
              className="font-mono tabular-nums"
              inputMode="numeric"
              maxLength={9}
              placeholder="012345678"
              {...form.register("code")}
            />
          </FormField>
          <Button disabled={form.formState.isSubmitting} type="submit" variant="outline">
            {form.formState.isSubmitting ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Search aria-hidden="true" />}
            {form.formState.isSubmitting ? "Finding…" : "Find Household"}
          </Button>
        </form>

        {matchedHousehold ? (
          <div className="mt-6 rounded-xl border bg-secondary p-5" aria-live="polite">
            <p className="text-caption font-medium uppercase tracking-wide text-text-secondary">Household found</p>
            <p className="panel-title mt-2 break-words">{matchedHousehold.name}</p>
            <p className="mt-1 font-mono text-body tabular-nums text-text-secondary">House code {matchedHousehold.code}</p>
            <p className="mt-4 text-body text-text-secondary">Only the household name and code are shown before acceptance.</p>
            {sendError ? <p className="mt-4 text-sm text-danger" role="alert">{sendError}</p> : null}
            <Button aria-busy={sending} className="mt-5 w-full sm:w-fit" disabled={sending} onClick={() => void sendRequest()} type="button">
              {sending ? <><LoaderCircle aria-hidden="true" className="animate-spin" /> Sending…</> : "Send Join Request"}
            </Button>
          </div>
        ) : null}

        <div className="mt-6 border-t pt-6"><Button asChild variant="ghost"><Link href="/household">Back to Household</Link></Button></div>
      </Surface>
    </PageContainer>
  );
}
