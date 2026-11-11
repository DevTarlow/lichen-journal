import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export function useModelSetup() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let off = () => {};
    api.model
      .status()
      .then((next) => {
        if (mountedRef.current) setStatus(next);
      })
      .catch(() => {});
    try {
      off = api.model.onStatus((next) => {
        if (mountedRef.current && next) setStatus(next);
      });
    } catch {
      // The bridge is unavailable in a plain browser preview.
    }
    return () => {
      mountedRef.current = false;
      off();
    };
  }, []);

  const run = useCallback(async (operation) => {
    setError(null);
    try {
      const result = await operation();
      return result;
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await run(() => api.model.status());
    if (mountedRef.current && next) setStatus(next);
    return next;
  }, [run]);

  const downloadAll = useCallback(async () => {
    const next = await run(() => api.model.download());
    if (mountedRef.current && next) setStatus(next);
    return next;
  }, [run]);

  const downloadAsset = useCallback(
    async (assetId) => {
      const next = await run(() => api.model.download(assetId));
      if (mountedRef.current && next) setStatus(next);
      return next;
    },
    [run]
  );

  const cancel = useCallback(async () => {
    const result = await run(() => api.model.cancel());
    return result;
  }, [run]);

  const importFolder = useCallback(async () => {
    const result = await run(() => api.model.importFolder());
    if (mountedRef.current && result?.status) setStatus(result.status);
    return result;
  }, [run]);

  const importFile = useCallback(
    async (assetId) => {
      const result = await run(() => api.model.importFile(assetId));
      if (mountedRef.current && result?.status) setStatus(result.status);
      return result;
    },
    [run]
  );

  return {
    status,
    error,
    refresh,
    downloadAll,
    downloadAsset,
    cancel,
    importFolder,
    importFile,
    clearError: () => setError(null)
  };
}
