import { ordsDetect, type OrdsDetectResult } from "$lib/workspace";

class OrdsStore {
  state = $state<OrdsDetectResult | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    const res = await ordsDetect();
    this.loading = false;
    if (res.ok) {
      this.state = res.data;
    } else {
      this.error = res.error.message;
      this.state = null;
    }
  }

  reset(): void {
    this.state = null;
    this.loading = false;
    this.error = null;
  }
}

export const ordsStore = new OrdsStore();
