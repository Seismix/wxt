import { describe, expect, it, vi } from 'vitest';
import { createExtensionRunner } from '..';
import { setFakeWxt } from '../../utils/testing/fake-objects';
import { mock } from 'vitest-mock-extended';
import { createSafariRunner } from '../safari';
import { createManualRunner } from '../manual';
import { createWebExtRunner } from '../web-ext';
import { ExtensionRunner } from '../../../types';
import { readFile } from 'node:fs/promises';

vi.mock('node:fs/promises');
const readFileMock = vi.mocked(readFile);

vi.mock('../safari');
const createSafariRunnerMock = vi.mocked(createSafariRunner);

vi.mock('../manual');
const createManualRunnerMock = vi.mocked(createManualRunner);

vi.mock('../web-ext');
const createWebExtRunnerMock = vi.mocked(createWebExtRunner);

describe('createExtensionRunner', () => {
  it('should return a Safari runner when browser is "safari"', async () => {
    setFakeWxt({
      config: {
        browser: 'safari',
      },
    });
    const safariRunner = mock<ExtensionRunner>();
    createSafariRunnerMock.mockReturnValue(safariRunner);

    await expect(createExtensionRunner()).resolves.toBe(safariRunner);
  });

  it('should return a manual runner when `runner.disabled` is true', async () => {
    setFakeWxt({
      config: {
        browser: 'chrome',
        runnerConfig: {
          config: {
            disabled: true,
          },
        },
      },
    });
    const manualRunner = mock<ExtensionRunner>();
    createManualRunnerMock.mockReturnValue(manualRunner);

    await expect(createExtensionRunner()).resolves.toBe(manualRunner);
  });

  it('should return a warning runner for chromium browsers in WSL', async () => {
    readFileMock.mockResolvedValueOnce(
      'Linux version 5.15.0 (microsoft-standard-WSL2)',
    );
    setFakeWxt({
      config: {
        browser: 'chrome',
        runnerConfig: {
          config: {},
        },
      },
    });

    const runner = await createExtensionRunner();
    expect(runner.openBrowser).toBeDefined();
    expect(runner.closeBrowser).toBeDefined();
    expect(createWebExtRunnerMock).not.toHaveBeenCalled();
  });

  it('should return a web-ext runner for firefox in WSL', async () => {
    readFileMock.mockResolvedValueOnce(
      'Linux version 5.15.0 (microsoft-standard-WSL2)',
    );
    setFakeWxt({
      config: {
        browser: 'firefox',
        runnerConfig: {
          config: {},
        },
      },
    });
    const webExtRunner = mock<ExtensionRunner>();
    createWebExtRunnerMock.mockReturnValue(webExtRunner);

    await expect(createExtensionRunner()).resolves.toBe(webExtRunner);
  });

  it('should return a web-ext runner otherwise', async () => {
    setFakeWxt({
      config: {
        browser: 'chrome',
        runnerConfig: {
          config: {
            disabled: undefined,
          },
        },
      },
    });
    const manualRunner = mock<ExtensionRunner>();
    createWebExtRunnerMock.mockReturnValue(manualRunner);

    await expect(createExtensionRunner()).resolves.toBe(manualRunner);
  });
});
