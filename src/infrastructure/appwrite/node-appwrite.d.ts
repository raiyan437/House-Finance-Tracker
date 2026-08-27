import type { Models } from "node-appwrite";

declare module "node-appwrite" {
  interface TablesDB {
    /**
     * The generated v28 declaration marks xdefault optional, while the runtime
     * and Appwrite update endpoint require it. Null preserves no default for a
     * required column.
     */
    updateStringColumn(params: {
      databaseId: string;
      tableId: string;
      key: string;
      required: boolean;
      xdefault: string | null;
      size?: number;
      newKey?: string;
    }): Promise<Models.ColumnString>;
  }
}
