import { save, open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Show a "Save As" dialog and write sql to the chosen path.
 * Returns the chosen path, or null if the user cancelled.
 */
export async function saveAs(sql: string, defaultName: string): Promise<string | null> {
  const path = await save({
    defaultPath: `${defaultName}.sql`,
    filters: [{ name: "SQL Files", extensions: ["sql"] }],
  });
  if (!path) return null;
  await writeTextFile(path, sql);
  return path;
}

/**
 * Write sql to an existing path silently.
 */
export async function saveExisting(path: string, sql: string): Promise<void> {
  await writeTextFile(path, sql);
}

/**
 * Show an "Open" dialog and read the chosen file.
 * Returns { path, content } or null if cancelled.
 */
export async function openFile(): Promise<{ path: string; content: string } | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "SQL Files", extensions: ["sql"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const content = await readTextFile(path as string);
  return { path: path as string, content };
}
