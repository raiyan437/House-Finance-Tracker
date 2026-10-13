import "server-only";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { AppwriteCommandContext } from "./command-context.server";

/** receipt commands retain their original complete transaction boundaries. */
export class AppwriteReceiptCommands implements Pick<AtomicApplicationPersistence, "createReceipt" | "deleteReceipt"> {
  constructor(private readonly context: AppwriteCommandContext) {}

createReceipt(): Promise<string> { return this.context.unavailable(); }

deleteReceipt(): Promise<void> { return this.context.unavailable(); }
}
