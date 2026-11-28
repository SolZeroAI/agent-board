import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

/** Ask an HTTP watcher to wake up. The Worker performs the request. */
export class Wake extends Domain.ExternalSystem("Wake", {
  notify: {
    args: { url: Schema.String, body: Schema.String },
    success: { status: Schema.Number },
  },
}) {}
