// @ts-nocheck
/*
 * Copyright 2026 Vercel Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Ported into Agent Board, which is licensed AGPL-3.0-only.
 * Modified to call the Agent Board API and to leave out Slack, GitHub, and Linear.
 * See NOTICE at the repository root.
 */
import type { BoardEventView, MessagesPage, ThreadsPage } from "./types.ts";
import * as store from "./store.ts";

// How a channel's view loads: a page of its threads at a time, by latest activity, from the board's
// thread list. A board whose pages have no `older` is from before it, and its channels show their
// newest messages, with no page before them.

/** What the view reads of the board. */
export type ListingClient = {
  threads(query: { channel: string; limit: number; before?: string }): Promise<ThreadsPage>;
  /** One channel's newest messages. */
  messages(channel: string): Promise<MessagesPage>;
};

const THREADS = 25;

export function listing(
  client: ListingClient,
  get: () => store.State,
  set: (next: (state: store.State) => store.State) => void,
  limit = THREADS,
) {
  /** A first page being read again, per channel, and whether something asked for it once more since. */
  const refreshing = new Map<string, { again: boolean }>();

  async function messages(channel: string) {
    const page = await client.messages(channel);
    set((s) => store.merge(s, page.messages));
  }

  /** The channel's first page of threads, or on a board from before `older`, its latest messages. */
  async function load(channel: string) {
    set((s) => store.listing(s, channel));
    const page = await client.threads({ channel, limit }).catch((error: unknown) => {
      set((s) => store.unlisted(s, channel));
      throw error;
    });
    if (!("older" in page)) {
      set((s) => store.unpaged(s, channel));
      return messages(channel);
    }
    set((s) => store.mergeThreads(s, channel, page, "first"));
  }

  /** The next older page, from where the last one said it starts. Whether there's more. */
  async function older(channel: string): Promise<boolean> {
    const listed = store.listingOf(get(), channel);
    if (listed) {
      // Its first page is still on its way: try again once it's in.
      if (!listed.loaded) return true;
      if (listed.older === null) return false;
      const page = await client.threads({ channel, before: listed.older, limit });
      set((s) => store.mergeThreads(s, channel, page, "older"));
      return (page.older ?? null) !== null;
    }
    // A board that pages no threads back: its newest messages are all a channel's view has.
    return false;
  }

  const hasOlder = (channel: string) => {
    const listed = store.listingOf(get(), channel);
    return listed ? !listed.loaded || listed.older !== null : false;
  };

  /** Reads a channel's first page again, once for every burst that asks while it waits or reads. */
  function refresh(channel: string) {
    const running = refreshing.get(channel);
    if (running) {
      running.again = true;
      return;
    }
    const entry = { again: true };
    refreshing.set(channel, entry);
    void (async () => {
      try {
        // Asked for again in the same tick: still one read.
        await Promise.resolve();
        while (entry.again) {
          entry.again = false;
          const page = await client.threads({ channel, limit });
          set((s) => store.mergeThreads(s, channel, page, "first"));
        }
      } catch {
        // The next reply to a thread it doesn't have asks again.
      } finally {
        refreshing.delete(channel);
      }
    })();
  }

  /** Folds live events in; a reply to a thread a channel's listing doesn't have reads its first page again. */
  function apply(events: BoardEventView[]) {
    set((s) => events.reduce(store.applyEvent, s));
    const state = get();
    for (const event of events) {
      const channel = store.unlistedReply(state, event);
      if (channel !== null) refresh(channel);
    }
  }

  return { load, older, hasOlder, apply };
}
