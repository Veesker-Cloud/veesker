// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import { aiChat } from "$lib/workspace";
import type { AIProvider, ChatParams, ChatResult, ProviderError } from "../AIProvider";

export function BYOKProvider(): AIProvider {
  return {
    async chat(params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: ProviderError }> {
      return aiChat(params.apiKey, params.messages, params.context) as Promise<{ ok: true; data: ChatResult } | { ok: false; error: ProviderError }>;
    },
  };
}
