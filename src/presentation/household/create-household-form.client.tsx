"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dices, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  createHouseholdSchema,
  type CreateHouseholdInput,
  type CreateHouseholdValues,
} from "@/application/validation/household-onboarding.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/presentation/components/async-state";
import { Surface } from "@/presentation/components/surface";
import { FormField } from "@/presentation/forms/form-field";
import { userErrorMessage } from "@/presentation/errors/user-error-message";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { useIdempotentCommand } from "@/presentation/runtime/use-idempotent-command";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";

export function CreateHouseholdForm() {
  const router = useRouter();
  const runtime = useApplicationRuntime();
  const command = useIdempotentCommand();
  const [generationError, setGenerationError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const form = useForm<CreateHouseholdInput, unknown, CreateHouseholdValues>({
    resolver: zodResolver(createHouseholdSchema),
    defaultValues: { name: "", code: "" },
  });

  const mustReturn = runtime.status === "ready" && runtime.household.status !== "no-household" && !creating;
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

  async function generateCode() {
    setGenerationError(undefined);
    try {
      const code = await actions.generateCode();
      form.setValue("code", code, { shouldDirty: true, shouldValidate: true });
      form.setFocus("code");
    } catch {
      setGenerationError("A unique code could not be generated. Try again.");
    }
  }

  async function submit(values: CreateHouseholdValues) {
    form.clearErrors("root");
    setCreating(true);
    try {
      await actions.createHousehold(values.name, values.code, command.forIntent(JSON.stringify(values)));
      command.complete();
      toast.success("Household created.");
      router.replace("/dashboard");
    } catch (error) {
      setCreating(false);
      const message = userErrorMessage(error, "The household could not be created.");
      if (/code/i.test(message)) form.setError("code", { message });
      else form.setError("root", { message });
    }
  }

  return (
    <PageContainer className="grid gap-6">
      <PageHeader description="Choose a name and a globally unique nine-digit code." title="Create Household" />
      <Surface className="max-w-2xl" padding="large">
        <form className="grid gap-6" noValidate onSubmit={form.handleSubmit(submit)}>
          {form.formState.errors.root ? <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger" role="alert">{form.formState.errors.root.message}</p> : null}
          <FormField error={form.formState.errors.name?.message} label="House Name" required>
            <Input autoComplete="organization" placeholder="e.g. Raiyan House" {...form.register("name")} />
          </FormField>
          <FormField
            description="Exactly 9 digits. Leading zeroes are preserved."
            error={form.formState.errors.code?.message ?? generationError}
            label="House Code"
            required
          >
            <Input
              autoComplete="off"
              className="font-mono tabular-nums"
              inputMode="numeric"
              maxLength={9}
              placeholder="012345678"
              {...form.register("code")}
            />
          </FormField>
          <Button disabled={creating || form.formState.isSubmitting} onClick={() => void generateCode()} type="button" variant="outline">
            <Dices aria-hidden="true" /> Generate Code
          </Button>
          <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
            <Button asChild variant="ghost"><Link href="/household">Cancel</Link></Button>
            <Button aria-busy={creating} disabled={creating} type="submit">
              {creating ? <><LoaderCircle aria-hidden="true" className="animate-spin" /> Creating…</> : "Create Household"}
            </Button>
          </div>
        </form>
      </Surface>
    </PageContainer>
  );
}
