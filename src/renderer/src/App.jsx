import React, { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import Editor from './components/Editor.jsx';
import CompanionRail from './components/CompanionRail.jsx';
import AfterWritingOverview from './components/AfterWritingOverview.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import ReflectionAnswerModal from './components/ReflectionAnswerModal.jsx';
import DeletePageModal from './components/DeletePageModal.jsx';
import PhotoImportModal from './components/PhotoImportModal.jsx';
import ModelSetupModal from './components/ModelSetupModal.jsx';
import ResetAppModal from './components/ResetAppModal.jsx';
import ToastStack from './components/Toast.jsx';
import { AlertIcon, LichenMark } from './components/Icons.jsx';
import { api } from './lib/api.js';
import {
  addMonths,
  isDateInMonth,
  monthBounds,
  monthFromDate,
  todayISO
} from './lib/dates.js';
import { useTheme } from './hooks/useTheme.js';
import { usePreferences } from './hooks/usePreferences.js';
import { useAutosave } from './hooks/useAutosave.js';
import { useCompanion } from './hooks/useCompanion.js';
import { useModelSetup } from './hooks/useModelSetup.js';
import { useCompute } from './hooks/useCompute.js';
import { excerpt, mergePageText } from './lib/text.js';

const MODEL_SETUP_DISMISSED_KEY = 'lichen.model-setup-dismissed';

function readModelSetupDismissed() {
  try {
    return window.localStorage.getItem(MODEL_SETUP_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function persistModelSetupDismissed() {
  try {
    window.localStorage.setItem(MODEL_SETUP_DISMISSED_KEY, '1');
  } catch {
    // A blocked storage area should not stop the journal.
  }
}

function entryToSummary(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    date: entry.date,
    title: entry.title || '',
    excerpt: entry.excerpt !== undefined ? entry.excerpt : excerpt(entry.body || '', 240),
    mood: entry.mood ?? null,
    primaryEmotion: entry.primaryEmotion ?? null,
    palette: entry.palette ?? null,
    wordCount: entry.wordCount || 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    snippet: entry.snippet ?? null,
    tags: Array.isArray(entry.tags) ? entry.tags : []
  };
}

function mergeRecent(list, summary) {
  if (!summary) return list;
  const next = list.filter((item) => item.date !== summary.date);
  next.push(summary);
  next.sort((a, b) => b.date.localeCompare(a.date));
  return next.slice(0, 200);
}

function mergeMonthMap(map, summary, month) {
  if (!summary || !isDateInMonth(summary.date, month.year, month.month)) return map;
  const next = new Map(map);
  next.set(summary.date, summary);
  return next;
}

function draftFromEntry(entry) {
  return {
    title: typeof entry?.title === 'string' ? entry.title : '',
    body: typeof entry?.body === 'string' ? entry.body : ''
  };
}

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-mark">
        <LichenMark size={68} />
      </div>
      <p className="eyebrow">Private daily writing</p>
      <h1>Lichen Journal</h1>
      <p className="boot-tagline">
        Everything you write stays on your device. No subscriptions.
      </p>
      <span className="boot-loader" aria-label="Opening the local vault" />
    </div>
  );
}

function BootError({ error }) {
  return (
    <div className="boot-screen">
      <div className="boot-error-card" role="alert">
        <AlertIcon size={28} />
        <p className="eyebrow">The vault did not open</p>
        <h1>Lichen Journal could not start</h1>
        <p>
          {error?.message ||
            'The local vault is unavailable. Your existing journal file was not modified.'}
        </p>
        <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { preferences, updatePreferences } = usePreferences();
  const [bootState, setBootState] = useState('booting');
  const [bootError, setBootError] = useState(null);
  const [info, setInfo] = useState(null);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [entry, setEntry] = useState(null);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [month, setMonth] = useState(() => monthFromDate(todayISO()));
  const [monthEntries, setMonthEntries] = useState(() => new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTags, setActiveTags] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewIntent, setOverviewIntent] = useState('finish');
  const [accentColor, setAccentColor] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [previousQuestion, setPreviousQuestion] = useState(null);
  const [answerModal, setAnswerModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const [modelSetupDismissed, setModelSetupDismissed] = useState(readModelSetupDismissed);
  const [resetMode, setResetMode] = useState(null);
  const [minimalMode, setMinimalMode] = useState(false);

  const toastIdRef = useRef(0);
  const computeNoticeRef = useRef(null);
  const selectedDateRef = useRef(selectedDate);
  const monthRef = useRef(month);
  const entryRef = useRef(entry);
  const draftRef = useRef(draft);
  const answerModalRef = useRef(null);
  const dismissedAnswersRef = useRef(new Set());
  const searchInputRef = useRef(null);
  const titleInputRef = useRef(null);
  const finishActionRef = useRef(null);
  const editorWrapRef = useRef(null);
  const selectSeqRef = useRef(0);
  const monthSeqRef = useRef(0);
  const searchSeqRef = useRef(0);
  const statsTimerRef = useRef(null);

  selectedDateRef.current = selectedDate;
  monthRef.current = month;
  entryRef.current = entry;
  draftRef.current = draft;
  answerModalRef.current = answerModal;

  const notify = useCallback((message, type = 'info', detail = '') => {
    toastIdRef.current += 1;
    const id = `toast-${toastIdRef.current}-${Date.now()}`;
    setToasts((current) => [...current, { id, message, type, detail }]);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const scheduleStatsRefresh = useCallback(() => {
    if (statsTimerRef.current) window.clearTimeout(statsTimerRef.current);
    statsTimerRef.current = window.setTimeout(async () => {
      statsTimerRef.current = null;
      try {
        const next = await api.vault.info();
        setStats(next.stats);
        setInfo((current) =>
          current ? { ...current, ...next, stats: next.stats } : current
        );
      } catch {
        // Stats are decorative; a failed refresh must never interrupt writing.
      }
    }, 650);
  }, []);

  const refreshTags = useCallback(async () => {
    try {
      const result = await api.vault.tags();
      setTags(result.tags);
    } catch {
      // Tags will catch up on the next successful operation.
    }
  }, []);

  const applyEntryUpdate = useCallback(
    (updated) => {
      if (!updated) return;
      if (updated.date === selectedDateRef.current) {
        entryRef.current = updated;
        setEntry(updated);
      }
      const summary = entryToSummary(updated);
      setRecent((current) => mergeRecent(current, summary));
      setMonthEntries((current) => mergeMonthMap(current, summary, monthRef.current));
      setDataVersion((value) => value + 1);
      scheduleStatsRefresh();
    },
    [scheduleStatsRefresh]
  );

  const handleSaved = useCallback(
    (result, meta) => {
      const saved = result && result.entry;
      if (!saved) return;
      if (meta.date === selectedDateRef.current) {
        entryRef.current = saved;
        setEntry(saved);
      }
      const summary = entryToSummary(saved);
      setRecent((current) => mergeRecent(current, summary));
      setMonthEntries((current) => mergeMonthMap(current, summary, monthRef.current));
      setDataVersion((value) => value + 1);
      scheduleStatsRefresh();
    },
    [scheduleStatsRefresh]
  );

  const {
    state: saveState,
    lastSavedAt,
    hydrate: hydrateDraft,
    flush: flushDraft
  } = useAutosave({
    date: selectedDate,
    draft,
    onSaved: handleSaved,
    onError: (error) => notify(error.message, 'error')
  });

  const handleCompanionEntry = useCallback(
    (updated) => {
      applyEntryUpdate(updated);
    },
    [applyEntryUpdate]
  );

  const handleCompanionRefresh = useCallback(() => {
    refreshTags();
    setDataVersion((value) => value + 1);
    scheduleStatsRefresh();
  }, [refreshTags, scheduleStatsRefresh]);

  const companion = useCompanion({
    onEntry: handleCompanionEntry,
    onRefresh: handleCompanionRefresh,
    onNotice: notify
  });
  const modelSetup = useModelSetup();
  const compute = useCompute();

  const openModelSetup = useCallback(() => {
    setModelSetupOpen(true);
  }, []);

  const closeModelSetup = useCallback(() => {
    setModelSetupOpen(false);
    setModelSetupDismissed(true);
    persistModelSetupDismissed();
  }, []);

  const handleModelDownloadAsset = useCallback(
    async (assetId) => {
      try {
        await modelSetup.downloadAsset(assetId);
      } catch (error) {
        notify(error.message, 'error');
      }
    },
    [modelSetup, notify]
  );

  const handleModelImportFile = useCallback(
    async (assetId) => {
      try {
        await modelSetup.importFile(assetId);
      } catch (error) {
        notify(error.message, 'error');
      }
    },
    [modelSetup, notify]
  );

  const handleModelImportFolder = useCallback(async () => {
    try {
      const result = await modelSetup.importFolder();
      if (result && !result.canceled && !result.imported?.length) {
        notify('We couldn’t find the right files in that folder.', 'error');
      } else if (result?.failed?.length) {
        notify('Some files couldn’t be added. Check the folder and try again.', 'error');
      }
    } catch (error) {
      notify(error.message, 'error');
    }
  }, [modelSetup, notify]);

  useEffect(() => {
    if (bootState !== 'ready' || !modelSetup.status) return;
    if (modelSetup.status.allReady) {
      if (modelSetupDismissed) {
        setModelSetupDismissed(false);
        try {
          window.localStorage.removeItem(MODEL_SETUP_DISMISSED_KEY);
        } catch {
          // Storage is optional.
        }
      }
      return;
    }
    if (!modelSetupDismissed) setModelSetupOpen(true);
  }, [bootState, modelSetup.status, modelSetupDismissed]);

  useEffect(() => {
    if (settingsOpen) compute.refresh();
  }, [settingsOpen, compute.refresh]);

  useEffect(() => {
    const notice = compute.notice;
    if (!notice || settingsOpen || modelSetupOpen) return;
    if (computeNoticeRef.current === notice.id) return;
    computeNoticeRef.current = notice.id;
    notify(notice.message, 'info');
    compute.clearNotice();
  }, [
    compute.notice,
    compute.clearNotice,
    settingsOpen,
    modelSetupOpen,
    notify
  ]);

  const closeAnswerModal = useCallback((remember = true) => {
    const current = answerModalRef.current;
    if (remember && current) {
      dismissedAnswersRef.current.add(`${current.date}|${current.question}`);
    }
    setAnswerModal(null);
  }, []);

  const openAnswerModal = useCallback(({ date, question, answer = '', mode = 'add' }) => {
    if (!date || !question) return;
    setAnswerModal({
      date,
      question,
      answer: typeof answer === 'string' ? answer : '',
      mode
    });
  }, []);

  const openCurrentAnswer = useCallback(() => {
    const current = entryRef.current;
    if (!current || !current.reflection) return;
    const saved = Array.isArray(current.reflections)
      ? current.reflections.find((item) => item.question === current.reflection)
      : null;
    openAnswerModal({
      date: current.date,
      question: current.reflection,
      answer: saved ? saved.answer : '',
      mode: saved ? 'edit' : 'add'
    });
  }, [openAnswerModal]);

  const editReflection = useCallback(
    (reflection) => {
      const current = entryRef.current;
      if (!current || !reflection) return;
      openAnswerModal({
        date: current.date,
        question: reflection.question,
        answer: reflection.answer,
        mode: 'edit'
      });
    },
    [openAnswerModal]
  );

  const saveReflectionAnswer = useCallback(
    async (date, question, value, mode) => {
      const result = await api.vault.saveReflectionAnswer(date, question, value);
      applyEntryUpdate(result.entry);
      notify(
        mode === 'edit'
          ? 'Reflection updated.'
          : 'Reflection saved at the bottom of this page.',
        'success'
      );
      return result.entry;
    },
    [applyEntryUpdate, notify]
  );

  const maybeOpenAnswer = useCallback((saved) => {
    if (!saved || !saved.date || !saved.reflection) return;
    if (saved.date !== selectedDateRef.current) return;
    const answered = Array.isArray(saved.reflections)
      ? saved.reflections.some((item) => item.question === saved.reflection)
      : false;
    if (answered) return;
    if (dismissedAnswersRef.current.has(`${saved.date}|${saved.reflection}`)) return;
    setAnswerModal({
      date: saved.date,
      question: saved.reflection,
      answer: '',
      mode: 'add'
    });
  }, []);

  const toggleMinimalMode = useCallback(() => {
    const next = !minimalMode;
    setMinimalMode(next);
    if (next) {
      setSidebarOpen(false);
      setOverviewOpen(false);
    }
  }, [minimalMode]);

  const requestDeletePage = useCallback(() => {
    const current = entryRef.current;
    if (!current) return;
    setDeleteTarget({ date: current.date, title: current.title || '' });
  }, []);

  const confirmDeletePage = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return null;
    await flushDraft();
    companion.cancel();
    companion.clearStream();
    const result = await api.vault.deleteEntry(target.date);

    if (target.date === selectedDateRef.current) {
      setEntry(null);
      entryRef.current = null;
      setDraft({ title: '', body: '' });
      hydrateDraft(null);
      setAccentColor(null);
      setOverviewOpen(false);
      setAnswerModal(null);
    }

    setRecent((current) => current.filter((item) => item.date !== target.date));
    setMonthEntries((current) => {
      if (!current.has(target.date)) return current;
      const next = new Map(current);
      next.delete(target.date);
      return next;
    });
    setDataVersion((value) => value + 1);
    refreshTags();
    scheduleStatsRefresh();
    notify('Page deleted. This day is empty again.', 'success');
    return result;
  }, [
    companion,
    deleteTarget,
    flushDraft,
    hydrateDraft,
    notify,
    refreshTags,
    scheduleStatsRefresh
  ]);

  const selectDate = useCallback(
    async (target) => {
      if (!target) return;
      const sequence = ++selectSeqRef.current;
      setOverviewOpen(false);
      setAnswerModal(null);
      setDeleteTarget(null);
      setPhotoOpen(false);
      companion.cancel();
      companion.clearStream();
      try {
        await flushDraft();
      } catch {
        return;
      }
      if (sequence !== selectSeqRef.current) return;
      try {
        const result = await api.vault.get(target);
        if (sequence !== selectSeqRef.current) return;
        const nextEntry = result.entry;
        hydrateDraft(nextEntry);
        setSelectedDate(target);
        setEntry(nextEntry);
        entryRef.current = nextEntry;
        setDraft(draftFromEntry(nextEntry));
        setAccentColor(null);
        setSidebarOpen(false);
        const targetMonth = monthFromDate(target);
        setMonth((current) =>
          current.year === targetMonth.year && current.month === targetMonth.month
            ? current
            : targetMonth
        );
      } catch (error) {
        notify(error.message, 'error');
      }
    },
    [companion, flushDraft, hydrateDraft, notify]
  );

  const openPhotoImport = useCallback(() => {
    setSidebarOpen(false);
    setOverviewOpen(false);
    setPhotoOpen(true);
  }, []);

  const handlePhotoAdd = useCallback(
    async ({ date, text }) => {
      const addition = typeof text === 'string' ? text.trim() : '';
      if (!date || !addition) {
        throw new Error('There are no words to add yet.');
      }

      if (date === selectedDateRef.current) {
        await flushDraft();
        const current = draftRef.current;
        const result = await api.vault.save(
          date,
          current.title,
          mergePageText(current.body, addition)
        );
        if (!result.entry) throw new Error('The page could not be saved.');
        setDraft({ title: result.entry.title || '', body: result.entry.body || '' });
        hydrateDraft(result.entry);
        handleSaved(result, { date });
        notify(
          current.body.trim()
            ? 'Photo text added below this page.'
            : 'Page added from photo.',
          'success'
        );
        return result.entry;
      }

      await flushDraft();
      const existingResult = await api.vault.get(date);
      const existing = existingResult.entry;
      const result = await api.vault.save(
        date,
        existing?.title || '',
        mergePageText(existing?.body || '', addition)
      );
      if (!result.entry) throw new Error('The page could not be saved.');
      await selectDate(date);
      notify('Page added from photo.', 'success');
      return result.entry;
    },
    [flushDraft, handleSaved, hydrateDraft, notify, selectDate]
  );

  const goToToday = useCallback(() => {
    selectDate(todayISO());
  }, [selectDate]);

  const changeMonth = useCallback((delta) => {
    setMonth((current) => addMonths(current, delta));
  }, []);

  const toggleTag = useCallback((tag) => {
    setActiveTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  }, []);

  const clearTags = useCallback(() => setActiveTags([]), []);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    api.vault
      .info()
      .then((next) => {
        setStats(next.stats);
        setInfo((current) =>
          current ? { ...current, ...next, stats: next.stats } : current
        );
      })
      .catch(() => {});
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await api.vault.openFolder();
      if (!result.opened) {
        notify(result.error || 'The vault folder could not be opened.', 'error');
      }
    } catch (error) {
      notify(error.message, 'error');
    }
  }, [notify]);

  const handleCopyText = useCallback(async (text) => {
    await api.app.copyText(text);
  }, []);

  const handleExport = useCallback(async () => {
    try {
      await flushDraft();
      const result = await api.vault.exportZip();
      if (result && !result.canceled) {
        notify(
          `Vault exported: ${result.entryCount} ${
            result.entryCount === 1 ? 'entry' : 'entries'
          }.`,
          'success',
          result.filePath
        );
      }
      return result;
    } catch (error) {
      notify(error.message, 'error');
      throw error;
    }
  }, [flushDraft, notify]);

  const resetAfterPurge = useCallback(
    (nextInfo) => {
      const today = todayISO();
      setInfo((current) => (current ? { ...current, ...nextInfo } : current));
      setStats(nextInfo.stats || null);
      setRecent([]);
      setTags([]);
      setSearchQuery('');
      setActiveTags([]);
      setSearchResults(null);
      setSelectedDate(today);
      selectedDateRef.current = today;
      setEntry(null);
      entryRef.current = null;
      setDraft({ title: '', body: '' });
      hydrateDraft(null);
      const todayMonth = monthFromDate(today);
      setMonth(todayMonth);
      monthRef.current = todayMonth;
      setMonthEntries(new Map());
      setAccentColor(null);
      setSidebarOpen(false);
      setOverviewOpen(false);
      setAnswerModal(null);
      setDeleteTarget(null);
      setPhotoOpen(false);
      setMinimalMode(false);
    },
    [hydrateDraft]
  );

  const handlePurge = useCallback(async () => {
    await flushDraft();
    const result = await api.vault.purge('PURGE');
    resetAfterPurge(result.info);
    notify('Vault cleared. A fresh page is waiting.', 'success');
    setDataVersion((value) => value + 1);
    return result;
  }, [flushDraft, notify, resetAfterPurge]);

  const handleConfirmReset = useCallback(async () => {
    if (!resetMode) return;
    await flushDraft();
    await companion.cancel();
    companion.clearStream();
    if (modelSetup.status?.busy) {
      try {
        await modelSetup.cancel();
      } catch {
        // The reset handler below reports a genuinely busy model store.
      }
    }
    await api.dev.reset(resetMode);
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // A blocked storage area should not block the reset.
    }
    window.location.reload();
  }, [companion, flushDraft, modelSetup, resetMode]);

  const handleOfflineCheck = useCallback(() => api.app.offlineCheck(), []);

  const handleSetMood = useCallback(
    async (mood) => {
      const current = entryRef.current;
      if (!current) return null;
      try {
        const result = await api.vault.setMood(current.date, mood);
        applyEntryUpdate(result.entry);
        return result.entry;
      } catch (error) {
        notify(error.message, 'error');
        return null;
      }
    },
    [applyEntryUpdate, notify]
  );

  const openOverview = useCallback(
    async (intent = 'finish') => {
      if (companion.busy || !draftRef.current.body.trim()) return;
      try {
        await flushDraft();
      } catch {
        return;
      }
      setOverviewIntent(intent);
      setOverviewOpen(true);
    },
    [companion.busy, flushDraft]
  );

  const openReview = useCallback(() => openOverview('review'), [openOverview]);

  const openReread = useCallback(() => openOverview('reread'), [openOverview]);

  const closeOverview = useCallback(() => {
    setOverviewOpen(false);
    window.requestAnimationFrame(() => finishActionRef.current?.focus());
  }, []);

  useEffect(() => {
    const node = editorWrapRef.current;
    if (!node) return;
    if (overviewOpen) {
      node.setAttribute('inert', '');
    } else {
      node.removeAttribute('inert');
    }
  }, [overviewOpen]);

  const runReflect = useCallback(async () => {
    if (companion.busy || !draftRef.current.body.trim()) return;
    try {
      await flushDraft();
    } catch {
      return;
    }
    setAnswerModal(null);
    const data = await companion.reflect(selectedDateRef.current, draftRef.current.body, {
      lens: preferences.reflectLens
    });
    if (data && data.entry) maybeOpenAnswer(data.entry);
  }, [companion, flushDraft, maybeOpenAnswer, preferences.reflectLens]);

  const runCarriedReflect = useCallback(async () => {
    if (companion.busy || !draftRef.current.body.trim() || !previousQuestion) return;
    try {
      await flushDraft();
    } catch {
      return;
    }
    setAnswerModal(null);
    const data = await companion.reflect(selectedDateRef.current, draftRef.current.body, {
      lens: preferences.reflectLens,
      carry: previousQuestion.reflection
    });
    if (data && data.entry) maybeOpenAnswer(data.entry);
  }, [companion, flushDraft, maybeOpenAnswer, preferences.reflectLens, previousQuestion]);

  const handleLensChange = useCallback(
    (lens) => {
      updatePreferences({ reflectLens: lens });
    },
    [updatePreferences]
  );

  const runExtractMetadata = useCallback(async () => {
    if (companion.busy || !draftRef.current.body.trim()) return null;
    try {
      await flushDraft();
    } catch {
      return null;
    }
    return companion.extractMetadata(selectedDateRef.current, draftRef.current.body);
  }, [companion, flushDraft]);

  const runMoodPalette = useCallback(async () => {
    if (companion.busy || !draftRef.current.body.trim()) return null;
    try {
      await flushDraft();
    } catch {
      return null;
    }
    return companion.moodPalette(selectedDateRef.current, draftRef.current.body);
  }, [companion, flushDraft]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const appInfo = await api.app.info();
        const [listResult, tagsResult, todayResult] = await Promise.all([
          api.vault.list({ limit: 200 }),
          api.vault.tags(),
          api.vault.get(todayISO())
        ]);
        if (cancelled) return;
        setInfo(appInfo);
        setStats(appInfo.stats);
        setRecent(listResult.entries);
        setTags(tagsResult.tags);
        const todayEntry = todayResult.entry;
        setEntry(todayEntry);
        entryRef.current = todayEntry;
        setDraft(draftFromEntry(todayEntry));
        hydrateDraft(todayEntry);
        setBootState('ready');
      } catch (error) {
        if (!cancelled) {
          setBootError(error);
          setBootState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateDraft]);

  useEffect(() => {
    if (bootState !== 'ready') return undefined;
    let cancelled = false;
    api.vault
      .previousReflection(selectedDate)
      .then((result) => {
        if (!cancelled) setPreviousQuestion(result.previous || null);
      })
      .catch(() => {
        // The carried question is a nicety; silence keeps the rail calm.
        if (!cancelled) setPreviousQuestion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bootState, selectedDate, dataVersion]);

  useEffect(() => {
    if (bootState !== 'ready') return undefined;
    let cancelled = false;
    const sequence = ++monthSeqRef.current;
    const bounds = monthBounds(month.year, month.month);
    api.vault
      .range(bounds.from, bounds.to)
      .then((result) => {
        if (cancelled || sequence !== monthSeqRef.current) return;
        const map = new Map();
        for (const item of result.entries) map.set(item.date, item);
        setMonthEntries(map);
      })
      .catch((error) => notify(error.message, 'error'));
    return () => {
      cancelled = true;
    };
  }, [bootState, month, notify]);

  useEffect(() => {
    if (bootState !== 'ready') return undefined;
    const query = searchQuery.trim();
    if (!query && activeTags.length === 0) {
      setSearchResults(null);
      setSearching(false);
      return undefined;
    }
    const sequence = ++searchSeqRef.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.vault.search(query, activeTags, 100);
        if (sequence !== searchSeqRef.current) return;
        setSearchResults(result.entries);
      } catch (error) {
        if (sequence === searchSeqRef.current) {
          notify(error.message, 'error');
        }
      } finally {
        if (sequence === searchSeqRef.current) setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [bootState, searchQuery, activeTags, dataVersion, notify]);

  useEffect(() => {
    let unsubscribe = () => {};
    try {
      unsubscribe = api.app.onFlushBeforeClose(async () => {
        try {
          await flushDraft();
        } catch {
          // The save error is already surfaced; let the close handshake finish.
        } finally {
          try {
            api.app.flushComplete();
          } catch {
            // The shell may already be shutting down.
          }
        }
      });
    } catch {
      // No bridge in a browser preview.
    }
    return () => unsubscribe();
  }, [flushDraft]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (answerModal || deleteTarget || photoOpen || modelSetupOpen || resetMode) return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'k') {
        event.preventDefault();
        setSidebarOpen(true);
        if (minimalMode) {
          setMinimalMode(false);
          window.requestAnimationFrame(() => searchInputRef.current?.focus());
        } else {
          searchInputRef.current?.focus();
        }
      } else if (modifier && key === 's') {
        event.preventDefault();
        flushDraft().catch(() => {});
      } else if (modifier && key === 'e') {
        event.preventDefault();
        openSettings();
      } else if (event.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else if (sidebarOpen) setSidebarOpen(false);
        else if (minimalMode) setMinimalMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    answerModal,
    deleteTarget,
    photoOpen,
    modelSetupOpen,
    resetMode,
    flushDraft,
    minimalMode,
    openSettings,
    settingsOpen,
    sidebarOpen
  ]);

  useEffect(() => {
    const handleBlur = () => {
      flushDraft().catch(() => {});
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [flushDraft]);

  useEffect(
    () => () => {
      if (statsTimerRef.current) window.clearTimeout(statsTimerRef.current);
    },
    []
  );

  if (bootState === 'booting') return <BootScreen />;
  if (bootState === 'error') return <BootError error={bootError} />;

  const shortcutLabel = info?.platform === 'darwin' ? '⌘' : 'Ctrl';
  const showDevTools = Boolean(info?.devReset);
  const showFirstRun =
    (stats?.entryCount ?? info?.stats?.entryCount ?? 0) === 0 &&
    !entry &&
    !draft.title.trim() &&
    !draft.body.trim();

  return (
    <div className={`app-shell${minimalMode ? ' is-minimal' : ''}`}>
      <Header
        info={info}
        theme={theme}
        minimal={minimalMode}
        showDevTools={showDevTools}
        onResetApp={() => setResetMode('fresh')}
        onResetAppMock={() => setResetMode('mock')}
        onToggleTheme={toggleTheme}
        onToggleMinimal={toggleMinimalMode}
        onOpenSettings={openSettings}
        onImportPhoto={openPhotoImport}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
      />

      <div className="workspace">
        <Sidebar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClearSearch={() => setSearchQuery('')}
          searchInputRef={searchInputRef}
          activeTags={activeTags}
          tags={tags}
          onToggleTag={toggleTag}
          onClearTags={clearTags}
          month={month}
          entriesByDate={monthEntries}
          selectedDate={selectedDate}
          onSelectDate={selectDate}
          onChangeMonth={changeMonth}
          onToday={goToToday}
          recentEntries={recent}
          searchResults={searchResults}
          searching={searching}
          info={info}
          stats={stats || info?.stats}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <button
          type="button"
          className={`sidebar-scrim ${sidebarOpen ? 'is-open' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
          tabIndex={sidebarOpen ? 0 : -1}
        />

        <div className="center-pane">
          <div className="center-pane-editor" ref={editorWrapRef}>
            <Editor
              selectedDate={selectedDate}
              draft={draft}
              onTitleChange={(value) => setDraft((current) => ({ ...current, title: value }))}
              onBodyChange={(value) => setDraft((current) => ({ ...current, body: value }))}
              entry={entry}
              saveState={saveState}
              lastSavedAt={lastSavedAt}
              onRetrySave={() => flushDraft().catch(() => {})}
              onReflect={runReflect}
              onFinishPage={() => openOverview('finish')}
              onReviewPage={openReview}
              aiBusy={Boolean(companion.busy)}
              finishActionRef={finishActionRef}
              accentColor={accentColor}
              titleInputRef={titleInputRef}
              showFirstRun={showFirstRun}
              onBeginWriting={() => titleInputRef.current?.focus()}
              onImportPhoto={openPhotoImport}
              shortcutLabel={shortcutLabel}
              pageTurn={preferences.pageTurn}
              onEditReflection={editReflection}
              onDeletePage={requestDeletePage}
            />
          </div>

          <AfterWritingOverview
            open={overviewOpen}
            intent={overviewIntent}
            selectedDate={selectedDate}
            title={draft.title}
            draftBody={draft.body}
            entry={entry}
            status={companion.status}
            busy={companion.busy}
            accentColor={accentColor}
            onClose={closeOverview}
            onExtractMetadata={runExtractMetadata}
            onMoodPalette={runMoodPalette}
            onSetMood={handleSetMood}
            onApplyAccent={setAccentColor}
            onOpenSettings={openSettings}
          />
        </div>

        <CompanionRail
          entry={entry}
          draftBody={draft.body}
          status={companion.status}
          busy={companion.busy}
          streamText={companion.streamText}
          lens={preferences.reflectLens}
          previousQuestion={previousQuestion}
          selectedDate={selectedDate}
          dataVersion={dataVersion}
          activeTags={activeTags}
          onLensChange={handleLensChange}
          onCarryPrevious={runCarriedReflect}
          onSelectDate={selectDate}
          onToggleTag={toggleTag}
          onSetMood={handleSetMood}
          onReadAgain={openReread}
          onReflect={runReflect}
          onAnswerReflection={openCurrentAnswer}
          onCancel={companion.cancel}
          onReloadModel={companion.reloadModel}
          onDownloadModel={openModelSetup}
          onOpenSettings={openSettings}
        />
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        info={info}
        theme={theme}
        preferences={preferences}
        onPreferencesChange={updatePreferences}
        stats={stats || info?.stats}
        aiStatus={companion.status}
        aiBusy={companion.busy}
        modelStatus={modelSetup.status}
        compute={compute.status}
        computeBusy={compute.busy}
        onUseCpu={compute.useCpu}
        onTestGpu={compute.testGpu}
        onDownloadAsset={handleModelDownloadAsset}
        onCancelModel={modelSetup.cancel}
        onImportModelFile={handleModelImportFile}
        onImportModelFolder={handleModelImportFolder}
        onCopy={handleCopyText}
        onOpenFolder={handleOpenFolder}
        onExport={handleExport}
        onPurge={handlePurge}
        onOfflineCheck={handleOfflineCheck}
        onReloadModel={companion.reloadModel}
      />

      {answerModal ? (
        <ReflectionAnswerModal
          open
          date={answerModal.date}
          question={answerModal.question}
          answer={answerModal.answer}
          mode={answerModal.mode}
          onSave={(value) =>
            saveReflectionAnswer(
              answerModal.date,
              answerModal.question,
              value,
              answerModal.mode
            )
          }
          onClose={(remember) => closeAnswerModal(remember)}
        />
      ) : null}

      {deleteTarget ? (
        <DeletePageModal
          open
          date={deleteTarget.date}
          title={deleteTarget.title}
          onConfirm={confirmDeletePage}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}

      {photoOpen ? (
        <PhotoImportModal
          open
          defaultDate={selectedDate}
          onAdd={handlePhotoAdd}
          onClose={() => setPhotoOpen(false)}
          onOpenSettings={() => {
            setPhotoOpen(false);
            openSettings();
          }}
        />
      ) : null}

      {modelSetupOpen ? (
        <ModelSetupModal
          open
          status={modelSetup.status}
          compute={compute.status}
          computeBusy={compute.busy}
          onUseCpu={compute.useCpu}
          onTestGpu={compute.testGpu}
          onClose={closeModelSetup}
          onDownloadAll={modelSetup.downloadAll}
          onDownload={modelSetup.downloadAsset}
          onCancel={modelSetup.cancel}
          onImportFolder={modelSetup.importFolder}
          onImportFile={modelSetup.importFile}
        />
      ) : null}

      {resetMode ? (
        <ResetAppModal
          open
          mode={resetMode}
          entryCount={(stats || info?.stats)?.entryCount ?? 0}
          modelDir={modelSetup.status?.modelDir || ''}
          modelBytes={modelSetup.status?.downloadedBytes || 0}
          onConfirm={handleConfirmReset}
          onClose={() => setResetMode(null)}
        />
      ) : null}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
