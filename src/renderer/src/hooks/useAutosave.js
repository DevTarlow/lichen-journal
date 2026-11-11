import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const AUTOSAVE_DELAY = 450;

export function useAutosave({ date, draft, onSaved, onError }) {
  const [state, setState] = useState('idle');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const baselineRef = useRef({ title: '', body: '' });
  const hasEntryRef = useRef(false);
  const latestRef = useRef({ date, draft });
  const timerRef = useRef(null);
  const chainRef = useRef(Promise.resolve());
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);

  onSavedRef.current = onSaved;
  onErrorRef.current = onError;
  latestRef.current = { date, draft };

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const performFlush = useCallback(async () => {
    const current = latestRef.current;
    const title = typeof current.draft.title === 'string' ? current.draft.title : '';
    const body = typeof current.draft.body === 'string' ? current.draft.body : '';
    const baseline = baselineRef.current;

    if (title === baseline.title && body === baseline.body) return null;

    if (!hasEntryRef.current && !title.trim() && !body.trim()) {
      baselineRef.current = { title, body };
      setState('idle');
      return null;
    }

    setState('saving');
    try {
      const result = await api.vault.save(current.date, title, body);
      baselineRef.current = { title, body };
      hasEntryRef.current = Boolean(result.entry);
      setLastSavedAt(Date.now());

      const latest = latestRef.current.draft;
      const stillDirty = latest.title !== title || latest.body !== body;
      setState(result.entry ? (stillDirty ? 'dirty' : 'saved') : 'idle');
      if (onSavedRef.current) onSavedRef.current(result, { date: current.date });
      return result;
    } catch (error) {
      setState('error');
      if (onErrorRef.current) onErrorRef.current(error);
      throw error;
    }
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    const job = chainRef.current.then(() => performFlush());
    chainRef.current = job.catch(() => {});
    return job;
  }, [clearTimer, performFlush]);

  const hydrate = useCallback(
    (entry) => {
      clearTimer();
      baselineRef.current = {
        title: typeof entry?.title === 'string' ? entry.title : '',
        body: typeof entry?.body === 'string' ? entry.body : ''
      };
      hasEntryRef.current = Boolean(entry);
      setState(entry ? 'saved' : 'idle');
      setLastSavedAt(entry && entry.updatedAt ? Date.parse(entry.updatedAt) : null);
    },
    [clearTimer]
  );

  useEffect(() => {
    const baseline = baselineRef.current;
    if (draft.title === baseline.title && draft.body === baseline.body) return undefined;
    if (!hasEntryRef.current && !draft.title.trim() && !draft.body.trim()) return undefined;

    setState((current) => (current === 'saving' ? current : 'dirty'));
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flush().catch(() => {});
    }, AUTOSAVE_DELAY);

    return () => {
      clearTimer();
    };
  }, [draft.title, draft.body, date, clearTimer, flush]);

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer]
  );

  return {
    state,
    lastSavedAt,
    hydrate,
    flush
  };
}
