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
import { useSyncExternalStore } from "react";

// The page's own state, which no board knows: what it's telling you, and which message you're editing.

function signal<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}

// --- which message you're editing ---------------------------------------------------

const editing = signal<string | null>(null);
export const setEditing = editing.set;
export const useEditing = editing.use;

// --- what went wrong, said once ----------------------------------------------------

export type Toast = { id: number; text: string };
const toasts = signal<Toast[]>([]);
let toastId = 0;

export function toast(text: string) {
  const id = ++toastId;
  toasts.set([...toasts.get(), { id, text }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), 6000);
}

export const useToasts = toasts.use;
