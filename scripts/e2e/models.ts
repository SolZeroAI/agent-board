import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import * as Predicate from "effect/Predicate";

const DEFAULT_DECISION_MODEL = "@cf/cloudflare/clef";
const DEFAULT_LANGUAGE_MODEL = "meta/muse-ember-1.0";

/**
 * AI SDK providers pointed at the Cloudflare AI Gateway REST API.
 * Gateway response caching stays off. Verified action replay is the only cache.
 */
export function e2eModels(options: { accountId: string; gatewayId: string; token: string }) {
  const account = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}`;

  const headers = {
    "cf-aig-gateway-id": options.gatewayId,
    "cf-aig-skip-cache": "true",
    "cf-aig-max-attempts": "3",
    "cf-aig-backoff": "exponential",
  };

  const anthropic = createAnthropic({
    baseURL: `${account}/ai/v1`,
    authToken: options.token,
    headers,
  });

  const openai = createOpenAI({ baseURL: `${account}/ai/v1`, apiKey: options.token, headers });

  const clef = (modelId: string) =>
    createTypeSafeAi({
      baseURL: `${account}/ai/run`,
      apiKey: options.token,
      headers,
      fetch: async (input, init) => {
        const url = String(input).replace(/\/systemone$/, `/${modelId}`);
        const bodies = questionBatches(init?.body);

        if (bodies.length === 1) return clefCall(url, init);

        return mergeAnswers(
          await Promise.all(bodies.map((body) => clefCall(url, { ...init, body }))),
        );
      },
    }).decisionModel(modelId.slice(modelId.lastIndexOf("/") + 1));

  const decisionModelId = process.env.E2E_DECISION_MODEL || DEFAULT_DECISION_MODEL;
  const languageModelId = process.env.E2E_LANGUAGE_MODEL || DEFAULT_LANGUAGE_MODEL;

  if (
    !decisionModelId.startsWith("@cf/cloudflare/clef") &&
    !decisionModelId.startsWith("anthropic/")
  ) {
    throw new Error(
      `E2E_DECISION_MODEL must name a Cloudflare Clef model or an anthropic/ model, not ${decisionModelId}.`,
    );
  }

  return {
    decisionModel: decisionModelId.startsWith("anthropic/")
      ? anthropic.decisionModel(decisionModelId)
      : clef(decisionModelId),
    languageModel: languageModelId.startsWith("anthropic/")
      ? anthropic(languageModelId)
      : openai.chat(languageModelId),
  };
}

const CLEF_MAX_QUESTIONS = 64;

function questionBatches(body: RequestInit["body"]) {
  if (!Predicate.isString(body)) return [body];
  const request: unknown = JSON.parse(body);

  if (!Predicate.isObject(request) || !Predicate.isObject(request.questions)) return [body];
  const questions = Object.entries(request.questions);

  if (questions.length <= CLEF_MAX_QUESTIONS) return [body];

  return Array.from({ length: Math.ceil(questions.length / CLEF_MAX_QUESTIONS) }, (_, batch) =>
    JSON.stringify({
      ...request,
      questions: Object.fromEntries(
        questions.slice(batch * CLEF_MAX_QUESTIONS, (batch + 1) * CLEF_MAX_QUESTIONS),
      ),
    }),
  );
}

async function clefCall(url: string, init: RequestInit | undefined) {
  const response = await fetch(url, init);

  if (!response.ok) return cloudflareFailure(response);
  // SAFETY: Workers AI wraps a successful /ai/run body as { result }. The provider validates result.
  const { result } = (await response.json()) as { result: unknown };

  return Response.json(result, { status: response.status });
}

async function mergeAnswers(responses: ReadonlyArray<Response>) {
  const failure = responses.find((response) => !response.ok);

  if (failure !== undefined) return failure;

  // SAFETY: clefCall already unwrapped each successful Workers AI body. The provider validates the merge.
  const results = (await Promise.all(
    responses.map((response) => response.json()),
  )) as ReadonlyArray<{
    readonly model?: string;
    readonly answers: Readonly<Record<string, { readonly type: string }>>;
    readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
  }>;

  const total = (key: "input_tokens" | "output_tokens") =>
    results.every((result) => Predicate.isNumber(result.usage?.[key]))
      ? results.reduce((sum, result) => sum + (result.usage?.[key] ?? 0), 0)
      : null;

  return Response.json({
    model: results[0]?.model,
    answers: Object.fromEntries(results.flatMap((result) => Object.entries(result.answers))),
    usage: { input_tokens: total("input_tokens"), output_tokens: total("output_tokens") },
  });
}

async function cloudflareFailure(response: Response) {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);

  if (Predicate.isObject(body) && Predicate.isString(body.message)) return response;

  const errors: ReadonlyArray<unknown> = Predicate.isObject(body)
    ? [body.errors, body.error].flatMap((list) => (Array.isArray(list) ? list : []))
    : [];

  const reasons = errors.flatMap((error) =>
    Predicate.isObject(error) && Predicate.isString(error.message)
      ? [Predicate.isNumber(error.code) ? `${error.code}: ${error.message}` : error.message]
      : [],
  );

  const reason = reasons.length === 0 ? response.statusText : reasons.join("; ");

  return Response.json(
    { message: `Cloudflare ${response.status}: ${reason}` },
    { status: response.status, statusText: response.statusText },
  );
}
