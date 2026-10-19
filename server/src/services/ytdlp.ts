import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { AppError, errors } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ytdlp');

/** YouTube video ids are 11 chars of [A-Za-z0-9_-]. Anything else is rejected. */
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(id: unknown): id is string {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}

export interface YtDlpResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Run yt-dlp with an explicit argument array. `shell` is disabled and user
 * input is never concatenated into a command string, so no shell injection is
 * possible. A hard timeout kills the process.
 */
export function runYtDlp(args: string[], timeoutMs = config.ytdlp.timeoutMs): Promise<YtDlpResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    // A broken IPv6 route makes yt-dlp hang on the first connection attempt
    // until the timeout fires. --force-ipv4 keeps it on the working stack.
    const argv = [
      ...(config.ytdlp.forceIpv4 ? ['--force-ipv4'] : []),
      ...config.ytdlp.extraArgs,
      ...args,
    ];
    const child = spawn(config.ytdlp.path, argv, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const maxBuffer = 32 * 1024 * 1024; // 32 MB
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(errors.timeout(`yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > maxBuffer) {
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(errors.upstreamUnavailable('yt-dlp output exceeded limit'));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log.error('failed to spawn yt-dlp', { err: String(err), path: config.ytdlp.path });
      reject(
        new AppError(
          'YTDLP_MISSING',
          503,
          'The media service is not installed on this server. See README (yt-dlp installation).',
          String(err),
        ),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      if (code === 0) {
        resolve({ stdout, stderr, durationMs });
      } else {
        log.warn('yt-dlp exited with error', { code, durationMs, stderr: stderr.slice(0, 800) });
        reject(classifyFailure(stderr, code));
      }
    });
  });
}

/** Map yt-dlp failures to stable, user-friendly errors. */
export function classifyFailure(stderr: string, code: number | null): AppError {
  const s = stderr.toLowerCase();
  if (s.includes('video unavailable') || s.includes('account associated with this video has been terminated')) {
    return errors.videoUnavailable(stderr.slice(0, 400));
  }
  if (s.includes('private video') || s.includes('sign in to confirm') || s.includes('age')) {
    return errors.videoUnavailable('private or age-restricted content');
  }
  if (s.includes('not available in your country') || s.includes('blocked in your country')) {
    return errors.videoUnavailable('not available in your region');
  }
  if (s.includes('unsupported url')) return errors.invalidInput('unsupported url');
  if (s.includes('no video formats found') || s.includes('requested format is not available')) {
    return errors.extractionFailed('no playable formats');
  }
  if (s.includes('getaddrinfo failed') || s.includes('network is unreachable') || s.includes('unable to download')) {
    return errors.upstreamUnavailable('network failure');
  }
  if (s.includes('http error 429') || s.includes('rate')) return errors.rateLimited();
  return errors.extractionFailed(`yt-dlp exit ${code}`);
}

/** Parse JSON lines produced by `--dump-json` (one object per line). */
export function parseJsonLines<T>(stdout: string): T[] {
  const out: T[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // Ignore malformed lines rather than failing the whole result set.
    }
  }
  return out;
}

/** Parse a single JSON document, tolerating trailing noise. */
export function parseJsonDoc<T>(stdout: string): T | null {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    const first = stdout.indexOf('{');
    const last = stdout.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(stdout.slice(first, last + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
