import { BoardApi } from "@agent-board/domain";
import { toCli } from "@alchemy.run/domain/Cli";
import * as Domain from "@alchemy.run/domain";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const boardUrl = Config.String("AGENT_BOARD_URL").pipe(Config.withDefault("http://127.0.0.1:8787"));

class BoardRequestFailed extends Schema.TaggedError<BoardRequestFailed>()("BoardRequestFailed", {
  path: Schema.String,
  status: Schema.Number,
}) {}

const postJson = (path: string, body: Readonly<Record<string, string>>, token?: string) =>
  Effect.gen(function* () {
    const url = yield* boardUrl;
    const client = yield* HttpClient.HttpClient;

    const prepared = yield* HttpClientRequest.post(`${url}${path}`).pipe(
      HttpClientRequest.bodyJson(body),
    );

    const request = Option.match(Option.fromNullishOr(token), {
      onNone: () => prepared,
      onSome: (value) => HttpClientRequest.setHeader(prepared, "authorization", `Bearer ${value}`),
    });

    const response = yield* client.execute(request);
    const text = yield* response.text;
    yield* Effect.sync(() => {
      process.stdout.write(text);
      process.stdout.write("\n");
    });

    return yield* HttpClientResponse.matchStatus({
      "2xx": () => Effect.void,
      orElse: () => Effect.fail(new BoardRequestFailed({ path, status: response.status })),
    })(response);
  });

const open = Command.make(
  "open",
  {
    title: Flag.String("title").pipe(Flag.withDefault("Board")),
    agentName: Flag.String("agent-name"),
    harness: Flag.String("harness"),
  },
  (config) =>
    postJson("/boards", {
      title: config.title,
      agentName: config.agentName,
      harness: config.harness,
    }),
);

const register = Command.make(
  "register",
  {
    agentName: Flag.String("agent-name"),
    harness: Flag.String("harness"),
    token: Flag.String("token"),
  },
  (config) =>
    postJson("/agents", { agentName: config.agentName, harness: config.harness }, config.token),
);

const api = toCli(BoardApi, {
  name: "api",
  headers: Effect.gen(function* () {
    const token = yield* Config.Redacted("AGENT_BOARD_TOKEN");

    return { authorization: `Bearer ${Redacted.value(token)}` };
  }),
});

const agentBoard = Command.make("agent-board").pipe(Command.withSubcommands([open, register, api]));

const protocol = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* boardUrl;

    return Domain.protocolHttp(url);
  }),
);

const main = Command.run(agentBoard, { version: "0.0.0" }).pipe(
  Effect.provide(protocol),
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(main);
