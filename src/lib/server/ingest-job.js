import { ingestSoraArchive } from './ingest.js';
import { closeDB } from '$lib/db.js';

let currentJob = null;

function createJob(config) {
  return {
    id: `${Date.now()}`,
    running: false,
    done: false,
    ok: false,
    error: null,
    phase: 'idle',
    archivePath: config.archivePath,
    dbPath: config.dbPath,
    dbEngine: config.dbEngine,
    manifestMode: config.manifestMode,
    found: 0,
    processed: 0,
    inserted: 0,
    skipped: 0,
    cameosInserted: 0,
    noTxt: 0,
    manifestsFound: 0,
    unknownJson: 0,
    thumbnailsFound: 0,
    previewsFound: 0,
    commentFilesFound: 0,
    commentsInserted: 0,
    commentProfilesUpserted: 0,
    avatarsDownloaded: 0,
    avatarsSkipped: 0,
    avatarsFailed: 0,
    avatarsRegistered: 0,
    avatarsCleared: 0,
    errors: 0,
    currentFile: '',
    startedAt: null,
    completedAt: null,
    messages: [],
  };
}

function publish(progress) {
  if (!currentJob) return;

  Object.assign(currentJob, {
    phase: progress.phase || currentJob.phase,
    found: progress.found ?? currentJob.found,
    processed: progress.processed ?? currentJob.processed,
    inserted: progress.inserted ?? currentJob.inserted,
    skipped: progress.skipped ?? currentJob.skipped,
    cameosInserted: progress.cameosInserted ?? currentJob.cameosInserted,
    noTxt: progress.noTxt ?? currentJob.noTxt,
    manifestsFound: progress.manifestsFound ?? currentJob.manifestsFound,
    unknownJson: progress.unknownJson ?? currentJob.unknownJson,
    thumbnailsFound: progress.thumbnailsFound ?? currentJob.thumbnailsFound,
    previewsFound: progress.previewsFound ?? currentJob.previewsFound,
    commentFilesFound: progress.commentFilesFound ?? currentJob.commentFilesFound,
    commentsInserted: progress.commentsInserted ?? currentJob.commentsInserted,
    commentProfilesUpserted: progress.commentProfilesUpserted ?? currentJob.commentProfilesUpserted,
    avatarsDownloaded: progress.avatarsDownloaded ?? currentJob.avatarsDownloaded,
    avatarsSkipped: progress.avatarsSkipped ?? currentJob.avatarsSkipped,
    avatarsFailed: progress.avatarsFailed ?? currentJob.avatarsFailed,
    avatarsRegistered: progress.avatarsRegistered ?? currentJob.avatarsRegistered,
    avatarsCleared: progress.avatarsCleared ?? currentJob.avatarsCleared,
    errors: progress.errors ?? currentJob.errors,
    currentFile: progress.currentFile ?? currentJob.currentFile,
  });

  if (progress.message) {
    currentJob.messages = [
      ...currentJob.messages.slice(-19),
      { at: new Date().toISOString(), level: progress.phase === 'error' ? 'error' : 'warn', text: progress.message },
    ];
  }
}

export function getIngestJob() {
  return currentJob || {
    running: false,
    done: false,
    ok: false,
    phase: 'idle',
    found: 0,
    processed: 0,
    inserted: 0,
    skipped: 0,
    cameosInserted: 0,
    noTxt: 0,
    manifestsFound: 0,
    unknownJson: 0,
    thumbnailsFound: 0,
    previewsFound: 0,
    commentFilesFound: 0,
    commentsInserted: 0,
    commentProfilesUpserted: 0,
    avatarsDownloaded: 0,
    avatarsSkipped: 0,
    avatarsFailed: 0,
    avatarsRegistered: 0,
    avatarsCleared: 0,
    errors: 0,
    currentFile: '',
    messages: [],
  };
}

export function startIngestJob(config) {
  if (currentJob?.running) {
    return currentJob;
  }

  currentJob = createJob(config);
  currentJob.running = true;
  currentJob.startedAt = new Date().toISOString();
  currentJob.phase = 'starting';

  closeDB().catch(() => {});

  ingestSoraArchive({
    archivePath: config.archivePath,
    dbPath: config.dbPath,
    dbEngine: config.dbEngine,
    manifestMode: config.manifestMode,
    // Comments live alongside videos in the same archive. Avatar download is
    // opt-in (Server panel → Assets tab → "Download missing avatars") because
    // the source SAS URLs decay quickly and most archives end up with broken
    // attempts on re-runs. The wizard finishes everything else end-to-end.
    commentsDir: config.archivePath,
    downloadAvatars: false,
    onProgress: publish,
  })
    .then((result) => {
      publish({ ...result, phase: 'complete' });
      currentJob.running = false;
      currentJob.done = true;
      currentJob.ok = true;
      currentJob.phase = 'complete';
      currentJob.completedAt = new Date().toISOString();
      closeDB().catch(() => {});
    })
    .catch((err) => {
      currentJob.running = false;
      currentJob.done = true;
      currentJob.ok = false;
      currentJob.error = err.message;
      currentJob.phase = 'failed';
      currentJob.completedAt = new Date().toISOString();
      currentJob.messages = [
        ...currentJob.messages.slice(-19),
        { at: new Date().toISOString(), level: 'error', text: err.message },
      ];
      closeDB().catch(() => {});
    });

  return currentJob;
}
