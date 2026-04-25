import { ordsDetect, type OrdsDetectResult } from "$lib/workspace";

const URL_KEY_PREFIX = "veesker.ords.baseUrl.";

function loadStoredUrl(connectionId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(URL_KEY_PREFIX + connectionId);
  } catch {
    return null;
  }
}

function saveStoredUrl(connectionId: string, url: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (url) window.localStorage.setItem(URL_KEY_PREFIX + connectionId, url);
    else window.localStorage.removeItem(URL_KEY_PREFIX + connectionId);
  } catch {
    /* localStorage may be unavailable */
  }
}

class OrdsStore {
  state = $state<OrdsDetectResult | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  private connectionId: string | null = null;

  setConnectionId(id: string | null): void {
    this.connectionId = id;
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    const res = await ordsDetect();
    this.loading = false;
    if (res.ok) {
      // Prefer manually-saved URL over ORDS_PROPERTIES detection.
      // The user may need to override (proxy, custom port) and we want that to stick.
      const stored = this.connectionId ? loadStoredUrl(this.connectionId) : null;
      this.state = stored ? { ...res.data, ordsBaseUrl: stored } : res.data;
    } else {
      this.error = res.error.message;
      this.state = null;
    }
  }

  setBaseUrl(url: string): void {
    if (this.state) this.state.ordsBaseUrl = url;
    if (this.connectionId) saveStoredUrl(this.connectionId, url);
  }

  reset(): void {
    this.state = null;
    this.loading = false;
    this.error = null;
    this.connectionId = null;
  }
}

export const ordsStore = new OrdsStore();
