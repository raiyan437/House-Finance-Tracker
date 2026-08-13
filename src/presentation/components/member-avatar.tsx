import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function initialsFromDisplayName(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toLocaleUpperCase("en");

  return `${words[0].slice(0, 1)}${words.at(-1)?.slice(0, 1) ?? ""}`.toLocaleUpperCase("en");
}

interface MemberAvatarProps extends React.ComponentProps<typeof Avatar> {
  readonly displayName: string;
}

export function MemberAvatar({
  displayName,
  className,
  ...props
}: MemberAvatarProps) {
  const initials = initialsFromDisplayName(displayName);

  return (
    <Avatar
      aria-label={displayName}
      className={cn("bg-brand-soft", className)}
      {...props}
    >
      <AvatarFallback aria-hidden="true">{initials}</AvatarFallback>
    </Avatar>
  );
}
