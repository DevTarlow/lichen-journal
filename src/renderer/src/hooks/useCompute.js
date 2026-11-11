import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

export function useCompute() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    api.compute
      .status()
      .then((next) => {
        if (mountedRef.current && next) setStatus(next);
      })
      .catch(() => {});

    let off = () => {};
    try {
      off = api.compute.onChanged((next) => {
        if (!mountedRef.current || !next) return;
        setStatus(next);
        if (next.event === 'fallback' && next.lastError && next.lastError.message) {
          setNotice({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            message: next.lastError.message
          });
        }
      });
    } catch {
      // The bridge is absent in a plain browser preview.
    }

    return () => {
      mountedRef.current = false;
      off();
    };
  }, []);

  const useCpu = useCallback(async () => {
    setBusy(true);
    try {
      const next = await api.compute.useCpu();
      if (mountedRef.current && next) setStatus(next);
      return { ok: true, status: next };
    } catch (error) {
      return {
        ok: false,
        message: error.message || 'The performance setting could not be saved.'
      };
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const testGpu = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.compute.testGpu();
      if (mountedRef.current && result && result.status) setStatus(result.status);
      return result;
    } catch (error) {
      return {
        ok: false,
        message: error.message || 'The video card could not be checked.'
      };
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.compute.status();
      if (mountedRef.current && next) setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  return { status, busy, notice, useCpu, testGpu, refresh, clearNotice };
}
