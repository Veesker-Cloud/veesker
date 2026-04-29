import { invoke } from "@tauri-apps/api/core";
import { applyFeatureFlags, resetFeatures } from "./features";

function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

export async function initAuth(): Promise<void> {
  const token = await invoke<string | null>("auth_token_get");
  if (!token) return;

  const exp = decodeJwtExp(token);
  if (!exp || Date.now() / 1000 > exp) {
    await invoke("auth_token_clear");
    resetFeatures();
    return;
  }

  const stored = localStorage.getItem("veesker:features");
  if (stored) {
    try {
      applyFeatureFlags(JSON.parse(stored));
    } catch {
      // malformed — ignore, background refresh will fix it
    }
  }

  // Background refresh — don't await, don't block startup
  void fetch("https://api.veesker.cloud/v1/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (res) => {
    if (res.status === 401) {
      await invoke("auth_token_clear");
      resetFeatures();
      localStorage.removeItem("veesker:features");
      return;
    }
    if (res.ok) {
      const data = await res.json();
      if (data.features) {
        applyFeatureFlags(data.features);
        localStorage.setItem("veesker:features", JSON.stringify(data.features));
      }
    }
  }).catch(() => {
    // offline — already applied from localStorage above
  });
}

export async function logout(): Promise<void> {
  await invoke("auth_token_clear");
  localStorage.removeItem("veesker:features");
  resetFeatures();
}
