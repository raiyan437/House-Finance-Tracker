"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_AVATAR_BYTES } from "@/domain/profile/avatar-policy";
import type { CommandId } from "@/domain/shared/identifiers";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { userErrorMessage } from "@/presentation/errors/user-error-message";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProfilePictureForm() {
  const runtime = useApplicationRuntime();
  if (runtime.status !== "ready") return null;
  return <ReadyProfilePictureForm key={runtime.session.userId} runtime={runtime} />;
}

function ReadyProfilePictureForm({ runtime }: Readonly<{ runtime: Extract<ReturnType<typeof useApplicationRuntime>, { status: "ready" }> }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{ file: File; commandId: CommandId }>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string }>();

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const resetSelection = () => {
    setSelection(undefined);
    setPreviewUrl(undefined);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <form
      className="mt-5 flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!selection || !runtime.profileActions.replaceAvatar) return;
        setPending(true);
        setStatus(undefined);
        try {
          await runtime.profileActions.replaceAvatar(selection.file, runtime.session.profileVersion, selection.commandId);
          resetSelection();
          setStatus({ kind: "success", message: "Profile picture updated successfully." });
        } catch (error) {
          setStatus({ kind: "error", message: userErrorMessage(error, "Profile picture could not be updated. Please try again.") });
        } finally {
          setPending(false);
        }
      }}
    >
      <MemberAvatar
        avatarVersion={runtime.session.profileVersion}
        className="size-24 shrink-0 text-xl ring-4 ring-brand-soft"
        displayName={runtime.session.displayName}
        imageSrc={previewUrl}
        userId={runtime.session.userId}
      />
      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          id="profile-picture-file"
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Profile picture file"
          aria-describedby={status?.kind === "error" ? "profile-picture-error" : "profile-picture-help"}
          aria-invalid={status?.kind === "error"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setStatus(undefined);
            if (!file) return;
            if (!ALLOWED_TYPES.has(file.type) || file.size < 1 || file.size > MAX_AVATAR_BYTES) {
              resetSelection();
              setStatus({ kind: "error", message: "Choose a valid JPEG, PNG or WebP image up to 5 MB." });
              return;
            }
            setSelection({ file, commandId: crypto.randomUUID() as CommandId });
            setPreviewUrl(URL.createObjectURL(file));
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={pending}>
            <ImageUp aria-hidden="true" className="size-4" />
            Change Photo
          </Button>
          {selection ? (
            <>
              <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Uploading…" : "Save Photo"}</Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={resetSelection}>
                <X aria-hidden="true" className="size-4" />
                Cancel
              </Button>
            </>
          ) : null}
        </div>
        <p id="profile-picture-help" className="mt-2 text-caption text-text-muted">JPEG, PNG or WebP. Maximum 5 MB.</p>
        {status ? (
          <p id={status.kind === "error" ? "profile-picture-error" : undefined} className={status.kind === "error" ? "mt-2 text-caption text-danger" : "mt-2 text-caption text-success"} role={status.kind === "error" ? "alert" : "status"}>
            {status.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
