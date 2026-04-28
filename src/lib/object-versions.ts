import { invoke } from "@tauri-apps/api/core";
import type { Result } from "$lib/workspace";

export type ObjectVersionEntry = {
  id: number;
  commitSha: string;
  ddlHash: string;
  captureReason: "baseline" | "compile";
  label: string | null;
  capturedAt: string;
};

export async function objectVersionCapture(
  connectionId: string,
  owner: string,
  objectType: string,
  objectName: string,
  ddl: string,
  reason: "baseline" | "compile",
): Promise<boolean> {
  try {
    const data = await invoke<{ captured: boolean }>("object_version_capture", {
      connectionId, owner, objectType, objectName, ddl, reason,
    });
    return data.captured;
  } catch {
    return false;
  }
}

export async function objectVersionList(
  connectionId: string,
  owner: string,
  objectType: string,
  objectName: string,
): Promise<Result<ObjectVersionEntry[]>> {
  try {
    const data = await invoke<ObjectVersionEntry[]>("object_version_list", {
      connectionId, owner, objectType, objectName,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionDiff(
  connectionId: string,
  shaA: string,
  shaB: string,
  filePath: string,
): Promise<Result<string>> {
  try {
    const data = await invoke<{ diff: string }>("object_version_diff", {
      connectionId, shaA, shaB, filePath,
    });
    return { ok: true, data: data.diff };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionLoad(
  connectionId: string,
  commitSha: string,
  filePath: string,
): Promise<Result<string>> {
  try {
    const data = await invoke<{ ddl: string }>("object_version_load", {
      connectionId, commitSha, filePath,
    });
    return { ok: true, data: data.ddl };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionLabel(
  connectionId: string,
  versionId: number,
  owner: string,
  objectType: string,
  objectName: string,
  label: string | null,
): Promise<Result<void>> {
  try {
    await invoke("object_version_label", {
      connectionId, versionId, owner, objectType, objectName, label,
    });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionSetRemote(
  connectionId: string,
  remoteUrl: string,
  pat: string,
): Promise<Result<void>> {
  try {
    await invoke("object_version_set_remote", { connectionId, remoteUrl, pat });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionPush(
  connectionId: string,
): Promise<Result<number>> {
  try {
    const data = await invoke<{ pushedCommits: number }>("object_version_push", { connectionId });
    return { ok: true, data: data.pushedCommits };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export async function objectVersionGetRemote(
  connectionId: string,
): Promise<Result<string | null>> {
  try {
    const data = await invoke<{ url: string | null }>("object_version_get_remote", { connectionId });
    return { ok: true, data: data.url };
  } catch (err) {
    return { ok: false, error: err as { code: number; message: string } };
  }
}

export function objectFilePath(owner: string, objectType: string, objectName: string): string {
  return `${owner}/${objectType.replaceAll(" ", "_")}/${objectName}.sql`;
}
