// Veesker license state.
//
// Honor-system based — see COMMERCIAL_USE.md. The app does not technically
// gate features by tier. This store just tracks the user's declared usage
// type so the UI can show or hide the "Commercial use" banner.
//
// In the future, an enterprise add-on may wire actual license-key validation
// here. For now, all values are user-declared via Settings.

import type { LicenseTier } from "$lib/plugins";

const USAGE_KEY = "veesker.usageType";
const TIER_KEY = "veesker.licenseTier";
const KEY_KEY = "veesker.licenseKey";
const ACK_KEY = "veesker.commercialUseAcked";

export type UsageType = "personal" | "commercial" | "unknown";

function load<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return (raw ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

class LicenseStore {
  usageType = $state<UsageType>(load<UsageType>(USAGE_KEY, "unknown"));
  tier = $state<LicenseTier>(load<LicenseTier>(TIER_KEY, "personal"));
  licenseKey = $state<string | null>(load<string>(KEY_KEY, "") || null);
  acknowledged = $state<boolean>(load<string>(ACK_KEY, "") === "1");

  setUsageType(type: UsageType): void {
    this.usageType = type;
    save(USAGE_KEY, type);
  }

  setTier(tier: LicenseTier): void {
    this.tier = tier;
    save(TIER_KEY, tier);
  }

  setLicenseKey(key: string | null): void {
    this.licenseKey = key && key.trim() ? key.trim() : null;
    save(KEY_KEY, this.licenseKey);
  }

  acknowledge(): void {
    this.acknowledged = true;
    save(ACK_KEY, "1");
  }

  // Should the "Commercial use requires subscription" banner be shown?
  // Shown when:
  //   - The user has declared commercial usage
  //   - AND they have not entered a license key
  //   - AND tier is still "personal"
  needsCommercialUpgrade = $derived(
    this.usageType === "commercial" &&
    this.tier === "personal" &&
    !this.licenseKey,
  );

  // Should the first-launch usage prompt appear?
  // Shown when:
  //   - The user has not yet declared usage type
  //   - AND has not acknowledged the commercial-use policy
  needsFirstLaunchPrompt = $derived(
    this.usageType === "unknown" && !this.acknowledged,
  );
}

export const license = new LicenseStore();
