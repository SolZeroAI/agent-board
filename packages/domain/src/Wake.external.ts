import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

/** The watcher callback did not complete. The command still commits. */
export class WakeFailed extends Schema.TaggedError<WakeFailed, { readonly brand: unique symbol }>()(
  "WakeFailed",
  { url: Schema.String },
) {}

/** Ask an HTTP watcher to wake up. The Worker performs the request. */
export class Wake extends Domain.ExternalSystem("Wake", {
  notify: {
    args: { url: Schema.String, body: Schema.String },
    success: { status: Schema.Finite },
    error: WakeFailed,
  },
}) {}
