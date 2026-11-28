// @ts-nocheck
import { EMOJI_TABLE } from "./emoji-table.ts";

export const ATTACHMENT_BYTES_MAX = 256_000;
export const ATTACHMENTS_PER_MESSAGE_MAX = 10;

const named = new Map<string, string>();

for (const [name, entry] of Object.entries(EMOJI_TABLE)) {
  named.set(name, entry.characters[0] ?? name);

  for (const alias of entry.aliases) named.set(alias, entry.characters[0] ?? name);
}

/** The short name the board stores, without surrounding colons. */
export const canonicalEmoji = (emoji: string) => emoji.replaceAll(":", "").trim().toLowerCase();

/** The character people see for a stored name. */
export const displayEmoji = (emoji: string) => named.get(canonicalEmoji(emoji)) ?? emoji;

export const mentionsMe = (text: string, person: { id: string; handle: string }) => {
  const body = text.replace(/```[\s\S]*?```/g, "");

  return body.includes(`@[${person.id}]`) || body.includes(`@${person.handle}`);
};

export const replaceMentions = (text: string, _names?: Record<string, string>) => text;

export const findBlocks = (_text: string): Array<{ schema?: string; data?: unknown }> => [];
