import { useEffect, useRef, useState } from 'react';

/** Tiny pub/sub so repo writes can invalidate live queries. Topics: 'chats' | `messages:${chatId}`. */
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function emit(topic: string): void {
  listeners.get(topic)?.forEach((l) => l());
}

export function subscribe(topic: string, l: Listener): () => void {
  let set = listeners.get(topic);
  if (!set) listeners.set(topic, (set = new Set()));
  set.add(l);
  return () => {
    set!.delete(l);
  };
}

/** Re-runs `query` on mount, when deps change, and whenever any of `topics` is emitted. */
export function useLiveQuery<T>(topics: string[], query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [data, setData] = useState<T>();
  const seq = useRef(0);
  const topicKey = topics.join('|');

  useEffect(() => {
    let alive = true;
    const run = () => {
      const mine = ++seq.current; // drop out-of-order results
      query()
        .then((r) => alive && mine === seq.current && setData(r))
        .catch(() => {});
    };
    run();
    const unsubs = topics.map((t) => subscribe(t, run));
    return () => {
      alive = false;
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey, ...deps]);

  return data;
}
