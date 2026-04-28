// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import { FEATURES } from "$lib/services/features";
import { BYOKProvider } from "./providers/BYOKProvider";
import { CloudProvider } from "./providers/CloudProvider";
import type { ChatParams, ChatResult, ProviderError } from "./AIProvider";

const FALLBACK_CODES = new Set(["CLOUD_UNAVAILABLE", "NETWORK_ERROR", "SERVICE_UNAVAILABLE"]);

export const AIService = {
  async chat(params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: ProviderError }> {
    if (!FEATURES.cloudAI) {
      return BYOKProvider().chat(params);
    }

    const cloudResult = await CloudProvider().chat(params);

    if (!cloudResult.ok) {
      // Only fall back on infra errors — never on auth or billing failures (would bypass payment)
      if (cloudResult.error.code && FALLBACK_CODES.has(cloudResult.error.code) && params.apiKey) {
        return BYOKProvider().chat(params);
      }
    }

    return cloudResult;
  },
};
