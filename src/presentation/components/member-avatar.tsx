import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { UserId } from "@/domain/shared/identifiers";
import { cn } from "@/lib/utils";
import { useOptionalApplicationRuntime } from "@/presentation/runtime/application-runtime-context";

export function initialsFromDisplayName(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toLocaleUpperCase("en");

  return `${words[0].slice(0, 1)}${words.at(-1)?.slice(0, 1) ?? ""}`.toLocaleUpperCase("en");
}

interface MemberAvatarProps extends React.ComponentProps<typeof Avatar> {
  readonly displayName: string;
  readonly userId?: UserId;
  readonly avatarVersion?: string | number;
  readonly imageSrc?: string;
}

export function MemberAvatar({
  displayName,
  userId,
  avatarVersion,
  imageSrc,
  className,
  ...props
}: MemberAvatarProps) {
  const runtime = useOptionalApplicationRuntime();
  const initials = initialsFromDisplayName(displayName);
  const avatarReadsEnabled = runtime?.status === "ready" && runtime.capabilities.avatarContentReads;
  const authorizedImageSrc = imageSrc ?? (userId && avatarReadsEnabled
    ? `/api/app/profile-avatar?userId=${encodeURIComponent(userId)}${avatarVersion === undefined ? "" : `&v=${encodeURIComponent(String(avatarVersion))}`}`
    : undefined);

  return (
    <Avatar
      aria-hidden="true"
      className={cn("bg-brand-soft", className)}
      {...props}
    >
      {authorizedImageSrc ? <AvatarImage alt="" src={authorizedImageSrc} /> : null}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}
