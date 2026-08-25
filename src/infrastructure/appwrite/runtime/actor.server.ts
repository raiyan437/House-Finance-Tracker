import "server-only";
import type { UserId } from "@/domain/shared/identifiers";

export type TrustedActorResolution =
  | Readonly<{ status: "authenticated"; userId: UserId; email: string }>
  | Readonly<{ status: "anonymous" }>
  | Readonly<{ status: "provider-unavailable" }>;

export class ActorRequiredError extends Error {
  constructor() {
    super("An authenticated actor is required.");
    this.name = "ActorRequiredError";
  }
}
