// Copyright Amazon.com, Inc. or its affiliates.

jest.mock('@jupyterlab/apputils', () => ({
  SessionContext: jest.fn(),
  SessionContextDialogs: jest.fn(),
  ISessionContext: {},
  Notification: {
    emit: jest.fn().mockReturnValue('notif-1'),
    update: jest.fn()
  }
}));
jest.mock('@jupyterlab/translation', () => ({
  ITranslator: {},
  nullTranslator: { load: jest.fn().mockReturnValue({}) }
}));
jest.mock('@jupyterlab/filebrowser', () => ({}));

import { Notification } from '@jupyterlab/apputils';
import { BuildPyramidCommand } from '../BuildPyramidCommand';
import { KernelService } from '../services/KernelService';
import { CommService } from '../services/CommService';

jest.mock('../services/KernelService');
jest.mock('../services/CommService');
jest.mock('../utils', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  KERNEL_SETUP_CODE: 'mock setup code'
}));

function createMockApp() {
  return {} as any;
}

function createMockManager() {
  return {} as any;
}

function createMockBrowser(files: Array<{ name: string; path: string }>) {
  const items = files.map(f => ({ name: f.name, path: f.path }));
  let index = 0;
  return {
    tracker: {
      currentWidget: {
        selectedItems: () => ({
          next: () => {
            if (index < items.length) {
              return { value: items[index++], done: false };
            }
            return { value: undefined, done: true };
          },
          [Symbol.iterator]() {
            let i = 0;
            return {
              next: () => {
                if (i < items.length) {
                  return { value: items[i++], done: false };
                }
                return { value: undefined, done: true };
              }
            };
          }
        })
      }
    }
  } as any;
}

describe('BuildPyramidCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isVisible', () => {
    it('returns true for .ntf files', () => {
      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.ntf', path: '/data/image.ntf' }])
      );
      expect(cmd.isVisible()).toBe(true);
    });

    it('returns true for .nitf files', () => {
      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.nitf', path: '/data/image.nitf' }])
      );
      expect(cmd.isVisible()).toBe(true);
    });

    it('returns true for .tif files', () => {
      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.tif', path: '/data/image.tif' }])
      );
      expect(cmd.isVisible()).toBe(true);
    });

    it('returns true for .tiff files', () => {
      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.tiff', path: '/data/image.tiff' }])
      );
      expect(cmd.isVisible()).toBe(true);
    });

    it('returns false for non-image files', () => {
      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([
          { name: 'data.geojson', path: '/data/data.geojson' }
        ])
      );
      expect(cmd.isVisible()).toBe(false);
    });

    it('returns false when no files are selected', () => {
      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([])
      );
      expect(cmd.isVisible()).toBe(false);
    });

    it('returns false when browser is null', () => {
      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        null
      );
      expect(cmd.isVisible()).toBe(false);
    });
  });

  describe('execute', () => {
    it('sends PYRAMID_BUILD_REQUEST and shows success notification', async () => {
      const mockKernel = { id: 'test-kernel', interrupt: jest.fn() };
      (KernelService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getKernel: jest.fn().mockReturnValue(mockKernel),
        dispose: jest.fn()
      }));

      (CommService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        sendMessageAsync: jest.fn().mockResolvedValue({
          status: 'SUCCESS',
          outputPath: '/data/image.ntf.r1'
        }),
        dispose: jest.fn()
      }));

      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.ntf', path: '/data/image.ntf' }])
      );

      await cmd.execute();

      const commInstance = (CommService as jest.Mock).mock.results[0].value;
      expect(commInstance.sendMessageAsync).toHaveBeenCalledWith(
        { type: 'PYRAMID_BUILD_REQUEST', dataset: '/data/image.ntf' },
        'PYRAMID_BUILD_RESPONSE',
        600000,
        expect.any(Function)
      );

      expect(Notification.emit).toHaveBeenCalledWith(
        'Building pyramid...',
        'in-progress',
        expect.objectContaining({ autoClose: false })
      );

      expect(Notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-1',
          message: 'Pyramid built: /data/image.ntf.r1',
          type: 'success',
          autoClose: 5000
        })
      );
    });

    it('shows error notification on build failure', async () => {
      const mockKernel = { id: 'test-kernel', interrupt: jest.fn() };
      (KernelService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getKernel: jest.fn().mockReturnValue(mockKernel),
        dispose: jest.fn()
      }));

      (CommService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        sendMessageAsync: jest.fn().mockResolvedValue({
          status: 'ERROR',
          error: 'File not found'
        }),
        dispose: jest.fn()
      }));

      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.ntf', path: '/data/image.ntf' }])
      );

      await cmd.execute();

      expect(Notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-1',
          message: 'Pyramid build failed: File not found',
          type: 'error',
          autoClose: false
        })
      );
    });

    it('updates notification with progress during build', async () => {
      const mockKernel = { id: 'test-kernel', interrupt: jest.fn() };
      (KernelService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getKernel: jest.fn().mockReturnValue(mockKernel),
        dispose: jest.fn()
      }));

      let capturedOnProgress: ((data: any) => void) | undefined;
      (CommService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        sendMessageAsync: jest
          .fn()
          .mockImplementation((_msg, _type, _timeout, onProgress) => {
            capturedOnProgress = onProgress;
            if (onProgress) {
              onProgress({ level: 2, totalLevels: 5, percent: 40 });
            }
            return Promise.resolve({
              status: 'SUCCESS',
              outputPath: '/data/image.ntf.r1'
            });
          }),
        dispose: jest.fn()
      }));

      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.ntf', path: '/data/image.ntf' }])
      );

      await cmd.execute();

      expect(capturedOnProgress).toBeDefined();
      expect(Notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-1',
          message: 'Building pyramid: level 2/5 (40%)',
          type: 'in-progress'
        })
      );
    });

    it('cancel action interrupts the kernel', async () => {
      const mockKernel = { id: 'test-kernel', interrupt: jest.fn() };
      (KernelService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getKernel: jest.fn().mockReturnValue(mockKernel),
        dispose: jest.fn()
      }));

      (CommService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        sendMessageAsync: jest.fn().mockResolvedValue({
          status: 'SUCCESS',
          outputPath: '/data/image.ntf.r1'
        }),
        dispose: jest.fn()
      }));

      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.ntf', path: '/data/image.ntf' }])
      );

      await cmd.execute();

      const emitCall = (Notification.emit as jest.Mock).mock.calls[0];
      const actions = emitCall[2].actions;
      expect(actions[0].label).toBe('Cancel');

      actions[0].callback();
      expect(mockKernel.interrupt).toHaveBeenCalled();
    });

    it('disposes kernel on success', async () => {
      const mockDispose = jest.fn();
      const mockKernel = { id: 'test-kernel', interrupt: jest.fn() };
      (KernelService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getKernel: jest.fn().mockReturnValue(mockKernel),
        dispose: mockDispose
      }));

      (CommService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        sendMessageAsync: jest.fn().mockResolvedValue({
          status: 'SUCCESS',
          outputPath: '/data/image.ntf.r1'
        }),
        dispose: jest.fn()
      }));

      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.ntf', path: '/data/image.ntf' }])
      );

      await cmd.execute();

      expect(mockDispose).toHaveBeenCalled();
    });

    it('disposes kernel on error', async () => {
      const mockDispose = jest.fn();
      (KernelService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockRejectedValue(new Error('Kernel failed')),
        getKernel: jest.fn().mockReturnValue(null),
        dispose: mockDispose
      }));

      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.ntf', path: '/data/image.ntf' }])
      );

      await cmd.execute();

      expect(mockDispose).toHaveBeenCalled();
    });

    it('shows error notification when exception thrown', async () => {
      (KernelService as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockRejectedValue(new Error('Kernel failed')),
        getKernel: jest.fn().mockReturnValue(null),
        dispose: jest.fn()
      }));

      const cmd = new BuildPyramidCommand(
        createMockApp(),
        createMockManager(),
        createMockBrowser([{ name: 'image.ntf', path: '/data/image.ntf' }])
      );

      await cmd.execute();

      expect(Notification.emit).toHaveBeenCalledWith(
        'Pyramid build failed: Kernel failed',
        'error',
        expect.objectContaining({ autoClose: false })
      );
    });
  });
});
