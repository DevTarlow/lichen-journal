import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

function makeRequestId() {
  try {
    return window.crypto.randomUUID();
  } catch {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function useCompanion({ onEntry, onRefresh, onNotice }) {
  const [status, setStatus] = useState({
    state: 'idle',
    modelPresent: false,
    backend: 'cpu',
    threads: 1,
    loadProgress: 0,
    error: null
  });
  const [busy, setBusy] = useState(null);
  const [streamText, setStreamText] = useState(null);
  const busyRef = useRef(null);
  const activeRequestRef = useRef(null);
  const callbacksRef = useRef({ onEntry, onRefresh, onNotice });

  callbacksRef.current = { onEntry, onRefresh, onNotice };

  useEffect(() => {
    let alive = true;
    api.ai
      .status()
      .then((next) => {
        if (alive && next) setStatus(next);
      })
      .catch(() => {});

    let offStatus = () => {};
    let offStream = () => {};
    try {
      offStatus = api.ai.onStatus((next) => {
        if (next) setStatus(next);
      });
      offStream = api.ai.onStream((payload) => {
        if (
          payload &&
          payload.requestId === activeRequestRef.current &&
          typeof payload.chunk === 'string'
        ) {
          setStreamText((current) => `${current || ''}${payload.chunk}`);
        }
      });
    } catch {
      // The bridge is absent in a plain browser; the app will show its boot error.
    }

    return () => {
      alive = false;
      offStatus();
      offStream();
    };
  }, []);

  const begin = useCallback((kind, requestId) => {
    busyRef.current = kind;
    activeRequestRef.current = requestId;
    setBusy(kind);
    if (kind === 'reflect') setStreamText('');
  }, []);

  const end = useCallback(() => {
    busyRef.current = null;
    activeRequestRef.current = null;
    setBusy(null);
    setStreamText(null);
  }, []);

  const reflect = useCallback(
    async (date, text, options = {}) => {
      if (busyRef.current) return null;
      const requestId = makeRequestId();
      begin('reflect', requestId);
      try {
        const data = await api.ai.reflect(requestId, date, text, {
          lens: options.lens,
          carry: options.carry
        });
        callbacksRef.current.onEntry(data.entry, date);
        callbacksRef.current.onRefresh();
        return data;
      } catch (error) {
        if (error.code !== 'AI_CANCELLED') {
          callbacksRef.current.onNotice(error.message, 'error');
        }
        return null;
      } finally {
        end();
      }
    },
    [begin, end]
  );

  const extractMetadata = useCallback(
    async (date, text) => {
      if (busyRef.current) return null;
      const requestId = makeRequestId();
      begin('metadata', requestId);
      try {
        const data = await api.ai.extractMetadata(requestId, date, text);
        callbacksRef.current.onEntry(data.entry, date);
        callbacksRef.current.onRefresh();
        return data;
      } catch (error) {
        if (error.code !== 'AI_CANCELLED') {
          callbacksRef.current.onNotice(error.message, 'error');
        }
        return null;
      } finally {
        end();
      }
    },
    [begin, end]
  );

  const moodPalette = useCallback(
    async (date, text) => {
      if (busyRef.current) return null;
      const requestId = makeRequestId();
      begin('palette', requestId);
      try {
        const data = await api.ai.moodPalette(requestId, date, text);
        callbacksRef.current.onEntry(data.entry, date);
        callbacksRef.current.onRefresh();
        return data;
      } catch (error) {
        if (error.code !== 'AI_CANCELLED') {
          callbacksRef.current.onNotice(error.message, 'error');
        }
        return null;
      } finally {
        end();
      }
    },
    [begin, end]
  );

  const cancel = useCallback(async () => {
    if (!activeRequestRef.current) return false;
    try {
      const result = await api.ai.cancel(activeRequestRef.current);
      return Boolean(result && result.cancelled);
    } catch {
      return false;
    }
  }, []);

  const reloadModel = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = 'model';
    setBusy('model');
    try {
      const next = await api.ai.reload();
      if (next) setStatus(next);
      callbacksRef.current.onNotice('The local companion is ready.', 'success');
    } catch (error) {
      callbacksRef.current.onNotice(error.message, 'error');
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }, []);

  const clearStream = useCallback(() => {
    setStreamText(null);
  }, []);

  return {
    status,
    busy,
    streamText,
    reflect,
    extractMetadata,
    moodPalette,
    cancel,
    reloadModel,
    clearStream
  };
}
