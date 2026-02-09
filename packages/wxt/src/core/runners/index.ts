import { readFile } from 'node:fs/promises';
import type { ExtensionRunner } from '../../types';
import { wxt } from '../wxt';
import { createManualRunner } from './manual';
import { createSafariRunner } from './safari';
import { createWebExtRunner } from './web-ext';

async function isWsl(): Promise<boolean> {
  try {
    const version = await readFile('/proc/version', 'utf8');
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
}

export async function createExtensionRunner(): Promise<ExtensionRunner> {
  if (wxt.config.browser === 'safari') return createSafariRunner();

  if (wxt.config.runnerConfig.config?.disabled) return createManualRunner();

  // Chromium browsers don't work in WSL due to a chrome-launcher bug that
  // converts --user-data-dir to a Windows UNC path, breaking the remote
  // debugging pipe. See https://github.com/GoogleChrome/chrome-launcher/issues/334
  if (wxt.config.browser !== 'firefox' && (await isWsl())) {
    return {
      async openBrowser() {
        wxt.logger.warn(
          'Chromium browsers are not yet supported in WSL. Use Firefox (`wxt dev -b firefox`) or load the extension manually. See https://github.com/GoogleChrome/chrome-launcher/issues/334',
        );
      },
      async closeBrowser() {},
    };
  }

  return createWebExtRunner();
}
