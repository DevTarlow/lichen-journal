import React from 'react';
import {
  BookOpenIcon,
  EyeIcon,
  EyeOffIcon,
  LichenMark,
  LockIcon,
  MenuIcon,
  MoonIcon,
  PhotoIcon,
  SettingsIcon,
  SunIcon,
  TrashIcon
} from './Icons.jsx';

export default function Header({
  info,
  theme,
  minimal,
  showDevTools = false,
  onResetApp,
  onResetAppMock,
  onToggleTheme,
  onToggleMinimal,
  onOpenSettings,
  onImportPhoto,
  onToggleSidebar
}) {
  return (
    <header className="app-header">
      <div className="header-brand">
        <button
          type="button"
          className="icon-button sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Show journal navigation"
        >
          <MenuIcon />
        </button>
        <div className="brand-mark-wrap">
          <LichenMark size={38} />
        </div>
        <div className="brand-copy">
          <h1>Lichen Journal</h1>
          <p>Private daily writing. All on your device.</p>
        </div>
      </div>

      <div className="header-actions">
        {showDevTools ? (
          <div className="header-dev-tools" role="group" aria-label="Developer reset tools">
            <button
              type="button"
              className="button button-quiet button-small dev-reset-button dev-reset-fresh"
              onClick={onResetApp}
              aria-label="Reset app (developer tool)"
              title="Developer: delete the journal, preferences, app settings, and downloaded models"
            >
              <TrashIcon size={13} />
              <span className="dev-reset-label">Reset app</span>
            </button>
            <button
              type="button"
              className="button button-quiet button-small dev-reset-button"
              onClick={onResetAppMock}
              aria-label="Reset app with mock data (developer tool)"
              title="Developer: reset the journal and preferences, keep models and compute settings, and load demo entries"
            >
              <BookOpenIcon size={13} />
              <span className="dev-reset-label">Reset + mock</span>
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="security-badge"
          onClick={onOpenSettings}
          title="Stays offline after setup. Files download only when you ask. No accounts, no sync, no analytics."
        >
          <LockIcon size={14} />
          <span>Private &amp; Offline</span>
        </button>

        <button
          type="button"
          className="icon-button settings-toggle"
          onClick={onOpenSettings}
          aria-label="Open vault settings"
          title="Vault settings"
        >
          <SettingsIcon size={18} />
        </button>

        <button
          type="button"
          className="icon-button minimal-toggle"
          onClick={onToggleMinimal}
          aria-label={minimal ? 'Leave minimal writing mode' : 'Enter minimal writing mode'}
          aria-pressed={Boolean(minimal)}
          title={minimal ? 'Leave minimal writing mode' : 'Minimal writing mode'}
        >
          {minimal ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>

        <button
          type="button"
          className="icon-button theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Parchment light theme' : 'Lichen dark theme'}
        >
          {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
        </button>

        <button
          type="button"
          className="icon-button photo-toggle"
          onClick={onImportPhoto}
          aria-label="Add a page from a photo"
          title="Add a page from a photo"
        >
          <PhotoIcon size={18} />
        </button>

      </div>
      <span className="sr-only" aria-live="polite">
        {info ? `Lichen Journal ${info.version}` : ''}
      </span>
    </header>
  );
}
