import { useEffect, useState } from "react";
import { readControl } from "@/lib/computers/control";

/**
 * Poll closed screens for control/secret prompts so blocked Bots can surface outside the screen.
 */

const INTERVAL_MS = 3_000;

export function useNeedsYouAmong(
  botIds: readonly string[],
  when: boolean,
): string | null {
  const [needed, setNeeded] = useState<string | null>(null);
  const key = botIds.join("\0");

  useEffect(() => {
    const ids = key.length === 0 ? [] : key.split("\0");
    if (!when || ids.length === 0) {
      setNeeded(null);
      return;
    }

    let live = true;
    const check = async () => {
      for (const id of ids) {
        const state = await readControl(id).catch(() => null);
        if (!live) return;
        if (state && (state.requested || state.secretWanted !== undefined)) {
          setNeeded(id);
          return;
        }
      }
      if (live) setNeeded(null);
    };

    void check();
    const timer = setInterval(() => void check(), INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [key, when]);

  return needed;
}

export function useNeedsYou(botId: string | undefined, when: boolean): boolean {
  return useNeedsYouAmong(botId ? [botId] : [], when) !== null;
}
