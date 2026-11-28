import * as Effect from "effect/Effect";

import type { State } from "./boardState.ts";
import { CurrentActor } from "./CurrentActor.ts";
import { ReadMarked } from "./parity.commands.ts";
import { Forbidden, InvalidChannel, UnknownAttachment, UnknownMessage } from "./rejections.ts";
import { asOpen, onBoard, snapshot } from "./scope.ts";
import { can } from "./grants.ts";
import { validChannel } from "./text.ts";

const mark = (
  kind: typeof ReadMarked.Type.kind,
  actorJson: string,
  fields: Partial<
    Omit<typeof ReadMarked.Type, "_tag" | "kind" | "actorJson" | "includeBookkeeping">
  >,
  includeBookkeeping = false,
) =>
  new ReadMarked({
    kind,
    includeBookkeeping,
    actorJson,
    ...Object.fromEntries(
      Object.entries(fields).filter((entry) => entry[0] !== "_tag" && entry[1] !== undefined),
    ),
  });

export const decideRead = (
  state: State,
  boardId: string,
  kind: typeof ReadMarked.Type.kind,
  fields: Partial<
    Omit<typeof ReadMarked.Type, "_tag" | "kind" | "actorJson" | "includeBookkeeping">
  > = {},
  includeBookkeeping = false,
) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    const open = asOpen(state);

    if (open._tag !== "Open") return yield* open;
    const member = onBoard(open, actor, boardId);

    if (member !== undefined) return yield* member;

    if (
      fields.channel !== undefined &&
      fields.channel !== "" &&
      !validChannel(fields.channel.replace(/\/$/, ""))
    ) {
      return yield* new InvalidChannel();
    }

    if (
      kind === "channel" &&
      fields.channel !== undefined &&
      !can(open.grants, actor, fields.channel.replace(/\/$/, ""), "read")
    ) {
      return yield* new Forbidden({ action: "read" });
    }

    if (kind === "thread" && fields.messageId !== undefined) {
      const message = open.threads[fields.messageId];

      if (message === undefined) return yield* new UnknownMessage();

      if (!can(open.grants, actor, message.channel, "read"))
        return yield* new Forbidden({ action: "read" });
    }

    if (kind === "attachment" && fields.messageId !== undefined) {
      const found = Object.values(open.threads).some((message) =>
        message.attachments.some((item) => item.attachmentId === fields.messageId),
      );

      if (!found) return yield* new UnknownAttachment();
    }

    if (kind === "explain" && actor._tag === "Human" && fields.channel !== undefined) {
      const manage = can(open.grants, actor, "*", "manage") || actor.role === "owner";

      if (!manage && fields.channel.length > 0) {
        // A caller may always explain their own access. The email field asks about someone else.
      }
    }

    return [mark(kind, snapshot(actor), fields, includeBookkeeping)];
  });
