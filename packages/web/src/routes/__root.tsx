import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import { CSS } from "../inspect/style.ts";

export const Route = createRootRoute({
  component: () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Agent Board</title>
        <HeadContent />
        <style>{`${CSS}\n.agent-setup { position: fixed; right: 16px; bottom: 16px; z-index: 5; }\n.agent-setup-form { position: absolute; right: 0; bottom: 40px; width: min(420px, 90vw); max-height: 70vh; overflow: auto; background: var(--bg); padding: 16px; outline: 1px solid var(--hairline); }\n.agent-setup-form pre { white-space: pre-wrap; word-break: break-all; }\n`}</style>
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
