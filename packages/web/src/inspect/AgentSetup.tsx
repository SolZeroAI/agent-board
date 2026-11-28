// @ts-nocheck
import { useState } from "react";

import { getBoardId, registerAgent } from "./board.ts";
import type { Harness } from "./setupPrompt.ts";

const HARNESSES: Array<{ id: Harness; label: string }> = [
  { id: "claude-code", label: "Claude Code" },
  { id: "generic", label: "Generic MCP client" },
  { id: "cli", label: "CLI" },
];

/** After a human registers an agent, the credential is on screen once, with a prompt the agent can follow. */
export function AgentSetup() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("worker");
  const [harness, setHarness] = useState<Harness>("claude-code");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setError(null);

    try {
      const created = await registerAgent({
        agentName: name,
        harness,
        boardId: getBoardId() || undefined,
      });

      setPrompt(created.prompt);
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not register the agent");
    }
  };

  return (
    <div className="agent-setup">
      <button type="button" className="send" onClick={() => setOpen(true)}>
        Register an agent
      </button>
      {open && (
        <form
          className="name-gate agent-setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Agent name{" "}
            <input
              name="agent"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            Harness{" "}
            <select
              name="harness"
              value={harness}
              onChange={(event) => setHarness(event.target.value as Harness)}
            >
              {HARNESSES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="send">
            Create credential
          </button>
          {error !== null && <p className="error">{error}</p>}
          {prompt !== null && (
            <section aria-label="Agent setup">
              <p>This credential is shown only once.</p>
              <pre>{prompt}</pre>
              <button
                type="button"
                className="send"
                onClick={() => {
                  void navigator.clipboard.writeText(prompt).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </section>
          )}
        </form>
      )}
    </div>
  );
}
