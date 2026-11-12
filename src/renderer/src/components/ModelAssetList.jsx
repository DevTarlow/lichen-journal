import React from 'react';
import { AlertIcon, CheckIcon, CpuIcon, PhotoIcon } from './Icons.jsx';

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(0)} MB`;
}

function stateLabel(asset) {
  switch (asset.state) {
    case 'ready':
      return 'Installed';
    case 'downloading':
      return 'Downloading';
    case 'verifying':
      return 'Checking';
    case 'installing':
      return 'Finishing';
    case 'paused':
      return 'Paused';
    case 'invalid':
      return 'Needs a fresh copy';
    case 'error':
      return 'Download failed';
    default:
      return 'Not downloaded';
  }
}

export default function ModelAssetList({
  status,
  assetIds,
  onDownload,
  onCancel,
  onImportFile,
  disabled = false,
  compact = false,
  showFile = !compact
}) {
  if (!status) {
    return <p className="model-assets-loading">Checking what&apos;s already here…</p>;
  }
  const busy = Boolean(status.busy || status.downloading);
  const assets = (assetIds || Object.keys(status.assets || {}))
    .map((id) => status.assets?.[id])
    .filter(Boolean);

  if (!assets.length) return null;

  return (
    <div className={`model-assets${compact ? ' is-compact' : ''}`}>
      {assets.map((asset) => {
        const active =
          asset.state === 'downloading' ||
          asset.state === 'verifying' ||
          asset.state === 'installing';
        const ready = asset.state === 'ready';
        const canDownload = !ready && !active;
        const blocked = disabled || (busy && status.downloading !== asset.id);
        return (
          <div key={asset.id} className={`model-asset is-${asset.state}`}>
            <div className="model-asset-icon" aria-hidden="true">
              {ready ? (
                <CheckIcon size={15} />
              ) : asset.id === 'companion' ? (
                <CpuIcon size={15} />
              ) : (
                <PhotoIcon size={15} />
              )}
            </div>
            <div className="model-asset-main">
              <div className="model-asset-head">
                <strong>{asset.label}</strong>
                <span className={`model-asset-state ${ready ? 'is-ok' : ''}`}>
                  {stateLabel(asset)}
                </span>
              </div>
              {showFile ? <code className="model-asset-file">{asset.file}</code> : null}
              <div className="model-asset-meta">
                <span>
                  {formatBytes(asset.bytesDownloaded)} / {formatBytes(asset.expectedBytes)}
                </span>
                {asset.canResume ? (
                  <span>Partly downloaded. You can pick up where you left off.</span>
                ) : null}
              </div>
              {active || asset.progress > 0 ? (
                <div
                  className="model-progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={asset.progress}
                  aria-label={`${asset.label} download progress`}
                >
                  <span style={{ width: `${Math.max(2, asset.progress)}%` }} />
                </div>
              ) : null}
              {asset.error ? (
                <p className="model-asset-error" role="alert">
                  <AlertIcon size={13} />
                  {asset.error.message}
                </p>
              ) : null}
            </div>
            <div className="model-asset-actions">
              {active && asset.state === 'downloading' && onCancel ? (
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={onCancel}
                >
                  Cancel
                </button>
              ) : null}
              {canDownload && onDownload ? (
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={() => onDownload(asset.id)}
                  disabled={blocked}
                >
                  {asset.state === 'paused'
                    ? 'Resume'
                    : asset.state === 'invalid'
                      ? 'Replace'
                      : asset.state === 'error'
                        ? 'Try again'
                        : 'Download'}
                </button>
              ) : null}
              {canDownload && onImportFile ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onImportFile(asset.id)}
                  disabled={blocked}
                >
                  Use a file
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
