import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { authClient } from "../auth.ts";
import { App } from "../inspect/App.tsx";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const session = authClient.useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="boot">connecting…</div>;

  if (session.data) return <App />;

  return <SignIn />;
}

function SignIn() {
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="name-gate"
      style={{ margin: "20vh auto" }}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);

        void authClient.signIn
          .email({
            email: String(data.get("email") ?? ""),
            password: String(data.get("password") ?? ""),
          })
          .then((result) => {
            if (result.error !== null && result.error !== undefined)
              setError(result.error.message ?? "Sign-in failed");
          });
      }}
    >
      <label>
        Email <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password{" "}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
        />
      </label>
      <button type="submit" className="send">
        Sign in
      </button>
      {error !== null && <p className="error">{error}</p>}
    </form>
  );
}
