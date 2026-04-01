import { supabase } from './supabase';

const SOURCE = 'mobile';
const LOG_QUEUE = [];
let flushing = false;

/**
 * Log a system event to the system_logs table.
 * Queues writes and flushes in batches to avoid spamming the DB.
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string} event - Short event name, e.g. 'trip_start_failed', 'auth_error'
 * @param {string} [message] - Human-readable description
 * @param {object} [metadata] - Extra context (JSON-serializable)
 */
export function logEvent(level, event, message, metadata) {
  LOG_QUEUE.push({
    source: SOURCE,
    level,
    event,
    message: message || null,
    metadata: metadata || {},
    created_at: new Date().toISOString(),
  });

  if (!flushing) flushQueue();
}

async function flushQueue() {
  if (LOG_QUEUE.length === 0) return;
  flushing = true;

  const batch = LOG_QUEUE.splice(0, LOG_QUEUE.length);

  try {
    const { error } = await supabase.from('system_logs').insert(batch);
    if (error) {
      // If insert fails, don't re-queue to avoid infinite loops
      console.log('[SystemLog] flush failed:', error.message);
    }
  } catch (e) {
    console.log('[SystemLog] flush error:', e.message);
  } finally {
    flushing = false;
    // If more items were queued while we were flushing, flush again
    if (LOG_QUEUE.length > 0) {
      setTimeout(flushQueue, 1000);
    }
  }
}

/**
 * Install global error handlers that auto-log unhandled errors.
 * Call once at app startup (e.g. in App.js or index.js).
 */
export function installErrorHandlers() {
  // Unhandled JS exceptions
  const defaultHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    logEvent('error', isFatal ? 'fatal_js_error' : 'js_error', error?.message, {
      stack: error?.stack?.substring(0, 1000),
      isFatal,
    });

    // Still call the default handler so the app behaves normally
    if (defaultHandler) defaultHandler(error, isFatal);
  });

  // Unhandled promise rejections
  const originalHandler = global.onunhandledrejection;
  global.onunhandledrejection = (event) => {
    const reason = event?.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    logEvent('error', 'unhandled_promise_rejection', message, {
      stack: reason?.stack?.substring(0, 1000),
    });

    if (originalHandler) originalHandler(event);
  };
}
