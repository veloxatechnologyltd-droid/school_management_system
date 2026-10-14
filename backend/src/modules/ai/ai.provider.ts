export interface AiPrompt { system: string; user: string; maxTokens: number; timeoutMs?: number }
export interface AiCompletion { text: string; inputTokens: number | null; outputTokens: number | null }
export interface AiProvider { readonly name: string; readonly model: string | null; complete(prompt: AiPrompt): Promise<AiCompletion> }

// Anthropic Messages API (Claude), the school-approved provider. Only used when AI_ENABLED=true, the school has switched AI on,
// and ANTHROPIC_API_KEY is set. Haiku keeps the cost per draft low; AI_MODEL can name another Claude model.
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  constructor(private readonly apiKey: string, model = 'claude-haiku-5-5', private readonly timeoutMs = 20_000, private readonly baseUrl = 'https://api.anthropic.com') { this.model = model; }
  async complete(prompt: AiPrompt): Promise<AiCompletion> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: prompt.maxTokens, temperature: 0.3, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }),
      signal: AbortSignal.timeout(prompt.timeoutMs ?? this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    const data = await response.json() as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (data.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('');
    return { text, inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null };
  }
}

// OpenAI Chat Completions API (cheap default model). JSON mode keeps replies machine-checkable; the reply is still validated.
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly model: string;
  constructor(private readonly apiKey: string, model = 'gpt-4o-mini', private readonly timeoutMs = 20_000, private readonly baseUrl = 'https://api.openai.com') { this.model = model; }
  async complete(prompt: AiPrompt): Promise<AiCompletion> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, max_tokens: prompt.maxTokens, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] }),
      signal: AbortSignal.timeout(prompt.timeoutMs ?? this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    const data = await response.json() as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: data.choices?.[0]?.message?.content ?? '', inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null };
  }
}

// AI_PROVIDER selects the adapter (default "anthropic", i.e. Claude). Keys: ANTHROPIC_API_KEY or OPENAI_API_KEY; AI_MODEL overrides the model;
// ANTHROPIC_BASE_URL points at a gateway or a local stand-in.
// There is no automatic fallback to another provider: a missing key means template drafts only.
export function configuredProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const choice = (env.AI_PROVIDER || 'anthropic').toLowerCase();
  if (choice === 'openai' && env.OPENAI_API_KEY) return new OpenAiProvider(env.OPENAI_API_KEY, env.AI_MODEL || undefined);
  if (choice === 'anthropic' && env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL || undefined, undefined, env.ANTHROPIC_BASE_URL || undefined);
  return null;
}
