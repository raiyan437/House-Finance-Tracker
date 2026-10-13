import { ApplicationError } from "../errors/application-error";
import { canonicalIntentDigest, type IdempotencyDescriptor } from "../idempotency/command-idempotency";
import { assertUserProfile, PROFILE_DISPLAY_NAME_MAX_LENGTH, type UserProfile } from "@/domain/records/domain-records";
import { commandId, type CommandId } from "@/domain/shared/identifiers";
import { type Dependencies } from "./service-context";


export class ProfileApplicationService {
  constructor(private readonly deps: Dependencies) {}
  async getCurrentProfile(): Promise<UserProfile> { const actor = await this.deps.session.getCurrentUserId(); const profile = await this.deps.repositories.profiles.getById(actor); if (!profile) throw new ApplicationError("NOT_FOUND", "Profile not found."); return profile; }
  async updateCurrentProfile(displayNameInput: string, expectedVersion: number, commandIdValue: CommandId): Promise<UserProfile> {
    const actor = await this.deps.session.getCurrentUserId();
    const displayName = displayNameInput.trim();
    if (displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      throw new ApplicationError("INVALID_INPUT", "Display name must be 20 characters or fewer.");
    }
    const current = await this.getCurrentProfile();
    assertUserProfile({ ...current, displayName });
    const idempotency: IdempotencyDescriptor = {
      actorId: actor,
      commandType: "update-profile-display-name",
      commandId: commandId(commandIdValue),
      intentDigest: canonicalIntentDigest({ displayName }),
    };
    await this.deps.atomic.updateCurrentProfile({ actorId: actor, displayName, expectedVersion, occurredAt: this.deps.values.now(), idempotency });
    return this.getCurrentProfile();
  }
}
