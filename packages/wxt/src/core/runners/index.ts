import type { ExtensionRunner } from '../../types';
import { wxt } from '../wxt';
import { createManualRunner } from './manual';
import { createSafariRunner } from './safari';
import { createWebExtRunner } from './web-ext';

export async function createExtensionRunner(): Promise<ExtensionRunner> {
  if (wxt.config.browser === 'safari') return createSafariRunner();

  if (wxt.config.runnerConfig.config?.disabled) return createManualRunner();

  return createWebExtRunner();
}
