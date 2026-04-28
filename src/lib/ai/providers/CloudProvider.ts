// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import type { AIProvider, ChatParams, ChatResult, ProviderError } from "../AIProvider";

export function CloudProvider(): AIProvider {
  return {
    async chat(_params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: ProviderError }> {
      return {
        ok: false,
        error: {
          code: "CLOUD_NOT_IMPLEMENTED",
          message: "Veesker Cloud is coming soon. Sign up at veesker.cloud to get notified.",
        },
      };
    },
  };
}
