import os from "node:os";
import path from "node:path";

/** Windows can lack a registered Documents folder in a newly created profile. */
export function resolveDocumentsDirectory(getPath: (name: "documents" | "home") => string): string {
  try {
    return getPath("documents");
  } catch {
    // Keep localized/redirected known folders whenever Electron can resolve
    // them. A missing registration must not abort Python or application startup.
    let home: string;
    try {
      home = getPath("home");
    } catch {
      home = os.homedir();
    }
    return path.join(home, "Documents");
  }
}
