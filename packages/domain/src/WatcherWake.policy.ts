import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";

import { Board } from "./Board.aggregate.ts";
import { WatchersMatched } from "./parity.commands.ts";
import { Wake } from "./Wake.external.ts";

/** POST each watcher that a command matched. A failed callback does not retry the command. */
export class WatcherWake extends Domain.Policy("WatcherWake", {
  from: Board,
  on: [WatchersMatched],
}) {}

export const WatcherWakeLive = WatcherWake.toLayer(
  Effect.gen(function* () {
    const wake = yield* Wake;

    return Effect.fn(function* ({ event }) {
      for (const url of event.urls) {
        yield* wake
          .notify({ url, body: JSON.stringify({ summary: event.summary }) })
          .pipe(Effect.catch(() => Effect.void));
      }
    });
  }),
);
