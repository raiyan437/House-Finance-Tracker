import type { UserId } from "@/domain/shared/identifiers";

/**
 * Presentation-safe session projection consumed by both composition roots.
 * Lives in the application layer so infrastructure read functions can build
 * it without reaching into presentation.
 */
export interface CurrentSessionView {
  readonly userId: UserId;
  readonly displayName: string;
  readonly displayEmail: string;
  readonly roleLabel: "Leader" | "Member" | "No active household";
  readonly householdName?: string;
  readonly settlementActionCount: number;
}
