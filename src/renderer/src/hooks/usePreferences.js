import { useCallback, useEffect, useState } from 'react';
import {
  PREFERENCE_STORAGE_KEY,
  applyPreferencesToDocument,
  readPreferences
} from '../lib/preferences.js';

export function usePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);

  useEffect(() => {
    applyPreferencesToDocument(preferences);
    try {
      window.localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences are a nicety; the app still works without storage.
    }
  }, [preferences]);

  const updatePreferences = useCallback((patch) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  return { preferences, updatePreferences };
}
