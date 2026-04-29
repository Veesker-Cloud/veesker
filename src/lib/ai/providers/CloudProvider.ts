// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import { invoke } from "@tauri-apps/api/core";
import type { AIProvider, ChatParams, ChatResult, ProviderError } from "../AIProvider";

export function CloudProvider(): AIProvider {
  return {
    async chat(params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: ProviderError }> {
      const token = await invoke<string | null>("auth_token_get");
      if (!token) {
        return { ok: false, error: { code: "UNAUTHORIZED", message: "Not logged in to Veesker Cloud. Sign in to use Cloud AI." } };
      }

      let res: Response;
      try {
        res = await fetch("https://api.veesker.cloud/v1/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            messages: params.messages,
            context: params.context,
          }),
        });
      } catch {
        return { ok: false, error: { code: "CLOUD_UNAVAILABLE", message: "Veesker Cloud is temporarily unavailable." } };
      }

      if (res.status === 401) {
        return { ok: false, error: { code: "UNAUTHORIZED", message: "Session expired. Please sign in again." } };
      }
      if (res.status === 402) {
        return { ok: false, error: { code: "PAYMENT_REQUIRED", message: "Credit limit reached. Visit veesker.cloud to top up." } };
      }
      if (!res.ok) {
        return { ok: false, error: { code: "CLOUD_UNAVAILABLE", message: "Veesker Cloud is temporarily unavailable." } };
      }

      const data = await res.json() as ChatResult;
      return { ok: true, data };
    },
  };
}
