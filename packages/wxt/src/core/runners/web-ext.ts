import type { WebExtRunInstance } from 'web-ext-run';
import { readFile, access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { ExtensionRunner } from '../../types';
import { formatDuration } from '../utils/time';
import defu from 'defu';
import { wxt } from '../wxt';

/**
 * Create an `ExtensionRunner` backed by `web-ext`.
 */
export function createWebExtRunner(): ExtensionRunner {
  let runner: WebExtRunInstance | undefined;

  return {
    canOpen() {
      return true;
    },
    async openBrowser() {
      const startTime = Date.now();

      if (
        wxt.config.browser === 'firefox' &&
        wxt.config.manifestVersion === 3
      ) {
        throw Error(
          'Dev mode does not support Firefox MV3. For alternatives, see https://github.com/wxt-dev/wxt/issues/230#issuecomment-1806881653',
        );
      }

      // Use WXT's logger instead of web-ext's built-in one.
      const webExtLogger = await import('web-ext-run/util/logger');
      webExtLogger.consoleStream.write = ({ level, msg, name }) => {
        if (level >= ERROR_LOG_LEVEL) wxt.logger.error(name, msg);
        if (level >= WARN_LOG_LEVEL) wxt.logger.warn(msg);
      };

      const wxtUserConfig = wxt.config.runnerConfig.config;

      // On WSL, resolve chromium wrapper scripts to the real binary.
      // Wrapper scripts (e.g. /usr/bin/google-chrome) redirect stdin/stdout/stderr
      // which breaks --remote-debugging-pipe used by web-ext.
      const chromiumBinary =
        wxt.config.browser !== 'firefox'
          ? await resolveChromiumBinaryForWsl(
              wxtUserConfig?.binaries?.[wxt.config.browser],
            )
          : undefined;

      const userConfig = {
        browserConsole: wxtUserConfig?.openConsole,
        devtools: wxtUserConfig?.openDevtools,
        startUrl: wxtUserConfig?.startUrls,
        keepProfileChanges: wxtUserConfig?.keepProfileChanges,
        chromiumPort: wxtUserConfig?.chromiumPort,
        ...(wxt.config.browser === 'firefox'
          ? {
              firefox: wxtUserConfig?.binaries?.firefox,
              firefoxProfile: wxtUserConfig?.firefoxProfile,
              pref: wxtUserConfig?.firefoxPref,
              args: wxtUserConfig?.firefoxArgs,
            }
          : {
              chromiumBinary,
              chromiumProfile: wxtUserConfig?.chromiumProfile,
              chromiumPref: defu(
                wxtUserConfig?.chromiumPref,
                DEFAULT_CHROMIUM_PREFS,
              ),
              args: [
                '--unsafely-disable-devtools-self-xss-warnings',
                ...(wxtUserConfig?.chromiumArgs ?? []),
              ],
            }),
      };

      const finalConfig = {
        ...userConfig,
        target:
          wxt.config.browser === 'firefox' ? 'firefox-desktop' : 'chromium',
        sourceDir: wxt.config.outDir,
        // Don't add a "Reload Manager" extension alongside dev extension, WXT
        // already handles reloads intenrally.
        noReloadManagerExtension: true,
        // WXT handles reloads, so disable auto-reload behaviors in web-ext
        noReload: true,
        noInput: true,
      };
      const options = {
        // Don't call `process.exit(0)` after starting web-ext
        shouldExitProgram: false,
      };
      wxt.logger.debug('web-ext config:', finalConfig);
      wxt.logger.debug('web-ext options:', options);

      const webExt = await import('web-ext-run');
      runner = await webExt.default.cmd.run(finalConfig, options);

      const duration = Date.now() - startTime;
      wxt.logger.success(`Opened browser in ${formatDuration(duration)}`);
    },

    async closeBrowser() {
      await runner?.exit();
    },
  };
}

// https://github.com/mozilla/web-ext/blob/e37e60a2738478f512f1255c537133321f301771/src/util/logger.js#L12
const WARN_LOG_LEVEL = 40;
const ERROR_LOG_LEVEL = 50;

/**
 * On WSL, resolve chromium wrapper scripts to the real binary. Linux packages
 * install wrapper scripts (e.g. `/usr/bin/google-chrome`) that redirect
 * stdin/stdout/stderr before exec'ing the real binary. This breaks
 * `--remote-debugging-pipe` because the pipe file descriptors get closed.
 *
 * See: https://github.com/GoogleChrome/chrome-launcher/issues/334
 */
async function resolveChromiumBinaryForWsl(
  configuredBinary: string | undefined,
): Promise<string | undefined> {
  if (!(await isWsl())) return configuredBinary;

  const binary = configuredBinary ?? (await findChromiumBinary());
  if (!binary) return configuredBinary;

  return resolveWrapperScript(binary);
}

async function isWsl(): Promise<boolean> {
  try {
    const version = await readFile('/proc/version', 'utf8');
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
}

const CHROMIUM_BINARY_PATHS = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

async function findChromiumBinary(): Promise<string | undefined> {
  for (const bin of CHROMIUM_BINARY_PATHS) {
    try {
      await access(bin, constants.X_OK);
      return bin;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function resolveWrapperScript(binary: string): Promise<string> {
  try {
    const resolved = await realpath(binary);
    const content = await readFile(resolved, 'utf8');

    if (!content.startsWith('#!')) return binary;

    // Match wrapper exec pattern: exec -a "$0" "$HERE/chrome" "$@"
    const execMatch = content.match(/exec\s+.*"\$HERE\/([^"]+)"/);
    if (!execMatch) return binary;

    const realBinary = join(dirname(resolved), execMatch[1]);
    await access(realBinary, constants.X_OK);

    wxt.logger.debug(
      `Resolved chromium wrapper script ${binary} → ${realBinary}`,
    );
    return realBinary;
  } catch {
    return binary;
  }
}

const DEFAULT_CHROMIUM_PREFS = {
  devtools: {
    synced_preferences_sync_disabled: {
      // Remove content scripts from sourcemap debugger ignore list so stack traces
      // and log locations show up properly, see:
      // https://github.com/wxt-dev/wxt/issues/236#issuecomment-1915364520
      skipContentScripts: false,
      // Was renamed at some point, see:
      // https://github.com/wxt-dev/wxt/issues/912#issuecomment-2284288171
      'skip-content-scripts': false,
    },
  },
};
