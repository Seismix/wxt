import { ExtensionRunner } from '../../types';
import { access, constants, open, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { wxt } from '../wxt';

export type WslRunnerReason = 'chromium' | 'snap-firefox';

/**
 * The WSL runner just logs a warning message, for the browsers `web-ext` can't
 * open in WSL.
 */
export function createWslRunner(reason: WslRunnerReason): ExtensionRunner {
  return {
    async openBrowser() {
      const outDir = relative(process.cwd(), wxt.config.outDir);
      wxt.logger.warn(
        reason === 'chromium'
          ? `Cannot open a Windows Chromium browser when using WSL. Install Chrome inside WSL (https://learn.microsoft.com/windows/wsl/tutorials/gui-apps) and set \`binaries.${wxt.config.browser}\` in your \`web-ext.config.ts\` if it isn't found automatically, or load "${outDir}" as an unpacked extension manually.`
          : `Cannot open the Snap version of Firefox when using WSL, its sandbox can't read the temporary profile in "${tmpdir()}". Load "${outDir}" as an unpacked extension manually, install a non-Snap Firefox (https://support.mozilla.org/kb/install-firefox-linux) and set \`binaries.firefox\` in your \`web-ext.config.ts\`, or set \`TMPDIR\` to a directory inside your home directory.`,
      );
    },
  };
}

/**
 * Returns true when the Firefox binary `web-ext` would launch is the Snap build
 * and it would fail to load `web-ext`'s temporary profile. The Snap sandbox
 * can't read the system temp directory, only the user's home directory.
 */
export async function isUnusableSnapFirefox(
  binary: string | undefined,
): Promise<boolean> {
  if (isInside(tmpdir(), homedir())) return false;

  const path = binary ?? (await which('firefox'));
  if (!path) return false;

  return isSnap(path);
}

/** The same commands, in the same order, `chrome-launcher` looks for on Linux. */
const LINUX_CHROMIUM_COMMANDS = [
  'google-chrome-stable',
  'google-chrome',
  'chromium-browser',
  'chromium',
];

/**
 * Returns the Linux Chromium binary to launch inside WSL, or `undefined` when
 * there isn't one. `chrome-launcher` would otherwise pick the Windows Chrome,
 * which can't be controlled from WSL: its `--remote-debugging-pipe` uses file
 * descriptors 3 and 4, and WSL only passes stdin, stdout and stderr through to
 * Windows processes.
 */
export async function findLinuxChromium(
  binary: string | undefined,
): Promise<string | undefined> {
  if (binary) return isWindowsBinary(binary) ? undefined : binary;

  for (const command of LINUX_CHROMIUM_COMMANDS) {
    const path = await which(command);
    // The Snap sandbox can't read the temporary profile, same as Firefox.
    if (path && !(await isSnap(path))) return path;
  }
}

function isWindowsBinary(path: string): boolean {
  return /\.exe$/i.test(path) || /^\/mnt\/[a-z]\//i.test(path);
}

/** Returns true when the binary is, or runs, a Snap package. */
async function isSnap(binary: string): Promise<boolean> {
  try {
    const resolved = await realpath(binary);
    if (resolved.includes('/snap/')) return true;

    // Ubuntu ships `/usr/bin/firefox` and `/usr/bin/chromium-browser` as shell
    // scripts that run the Snap, while a non-Snap browser is an ELF binary.
    const file = await open(resolved);
    try {
      const { buffer, bytesRead } = await file.read({
        buffer: Buffer.alloc(4096),
      });
      const head = buffer.subarray(0, bytesRead);
      if (head.subarray(0, 4).toString('latin1') === '\x7fELF') return false;
      return head.toString('utf8').includes('/snap/bin/');
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return !rel.startsWith('..') && !rel.startsWith('/');
}

/** Resolve an executable from `PATH`, like `which`. */
async function which(command: string): Promise<string | undefined> {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory, keep looking.
    }
  }
}
