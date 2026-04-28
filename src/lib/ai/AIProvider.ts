// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import type { AiContext, AiMessage, AiChatResult } from "$lib/workspace";

export type ChatParams = {
  apiKey: string;
  messages: AiMessage[];
  context: AiContext;
};

export type ChatResult = AiChatResult;

export type ProviderError = {
  code?: string;
  message: string;
};

export interface AIProvider {
  chat(params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: ProviderError }>;
}
