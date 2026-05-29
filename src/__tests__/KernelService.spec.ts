// Copyright Amazon.com, Inc. or its affiliates.

const mockNotificationEmit = jest.fn().mockReturnValue('notif-123');
const mockNotificationUpdate = jest.fn().mockReturnValue(true);
const mockNotificationManager = { has: jest.fn().mockReturnValue(false) };

jest.mock('@jupyterlab/apputils', () => ({
  SessionContext: jest.fn(),
  SessionContextDialogs: jest.fn().mockImplementation(() => ({
    selectKernel: jest.fn().mockResolvedValue(undefined)
  })),
  ISessionContext: {},
  Notification: {
    emit: mockNotificationEmit,
    update: mockNotificationUpdate,
    manager: mockNotificationManager
  }
}));
jest.mock('@jupyterlab/translation', () => ({
  ITranslator: {},
  nullTranslator: { load: jest.fn().mockReturnValue({}) }
}));
jest.mock('../utils', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  KERNEL_SETUP_CODE: 'mock setup code'
}));

import { KernelService, IOsmlProgressMessage } from '../services/KernelService';
import { KernelMessage } from '@jupyterlab/services';

function createMockManager() {
  return {
    sessions: {},
    kernelspecs: {}
  } as any;
}

function createMockKernel() {
  return {
    requestExecute: jest.fn(),
    interrupt: jest.fn(),
    isDisposed: false
  };
}

function makeStreamMsg(text: string): KernelMessage.IIOPubMessage {
  return {
    header: { msg_type: 'stream' },
    content: { text }
  } as any;
}

function makeStatusMsg(state: string): KernelMessage.IIOPubMessage {
  return {
    header: { msg_type: 'status' },
    content: { execution_state: state }
  } as any;
}

function makeErrorMsg(): KernelMessage.IIOPubMessage {
  return {
    header: { msg_type: 'error' },
    content: { ename: 'Error', evalue: 'fail', traceback: [] }
  } as any;
}

function progressJson(msg: Partial<IOsmlProgressMessage>): string {
  return JSON.stringify({
    source: 'osml',
    stage: 'pip_install',
    status: 'progress',
    message: 'Working...',
    percent: null,
    ...msg
  });
}

describe('KernelService', () => {
  let service: KernelService;
  let mockKernel: ReturnType<typeof createMockKernel>;
  let onIOPubHandler: (msg: KernelMessage.IIOPubMessage) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KernelService(createMockManager());
    mockKernel = createMockKernel();

    const mockFuture = {
      onIOPub: null as any,
      done: Promise.resolve()
    };
    mockKernel.requestExecute.mockReturnValue(mockFuture);

    // Inject a session context with a kernel
    (service as any).sessionContext = {
      session: { kernel: mockKernel },
      dispose: jest.fn()
    };

    // Capture the onIOPub handler when set
    Object.defineProperty(mockFuture, 'onIOPub', {
      set(handler: any) {
        onIOPubHandler = handler;
        // Immediately send idle to resolve the promise
        setTimeout(() => handler(makeStatusMsg('idle')), 0);
      },
      get() {
        return onIOPubHandler;
      }
    });
  });

  describe('executeKernelSetupCode', () => {
    it('emits an in-progress notification on start', async () => {
      await service.executeKernelSetupCode();

      expect(mockNotificationEmit).toHaveBeenCalledWith(
        'Initializing kernel...',
        'in-progress',
        expect.objectContaining({
          autoClose: false,
          actions: expect.arrayContaining([
            expect.objectContaining({ label: 'Cancel' })
          ])
        })
      );
    });

    it('updates existing notification when notificationId is provided', async () => {
      await service.executeKernelSetupCode('existing-id');

      expect(mockNotificationEmit).not.toHaveBeenCalled();
      expect(mockNotificationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'existing-id',
          message: 'Initializing kernel...',
          type: 'in-progress'
        })
      );
    });

    it('shows success notification when execution completes without progress messages', async () => {
      await service.executeKernelSetupCode();

      expect(mockNotificationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-123',
          message: 'Kernel ready',
          type: 'success',
          autoClose: 5000
        })
      );
    });

    it('updates notification on progress stream message with percent', async () => {
      const mockFuture = {
        onIOPub: null as any,
        done: Promise.resolve()
      };
      mockKernel.requestExecute.mockReturnValue(mockFuture);

      Object.defineProperty(mockFuture, 'onIOPub', {
        set(handler: any) {
          onIOPubHandler = handler;
          // Send progress then idle
          setTimeout(() => {
            handler(
              makeStreamMsg(
                progressJson({
                  status: 'progress',
                  message: 'Installing...',
                  percent: 50
                }) + '\n'
              )
            );
            handler(makeStatusMsg('idle'));
          }, 0);
        },
        get() {
          return onIOPubHandler;
        }
      });

      await service.executeKernelSetupCode();

      expect(mockNotificationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-123',
          message: 'Installing... (50%)',
          type: 'in-progress'
        })
      );
    });

    it('updates notification on progress stream message without percent (indeterminate)', async () => {
      const mockFuture = {
        onIOPub: null as any,
        done: Promise.resolve()
      };
      mockKernel.requestExecute.mockReturnValue(mockFuture);

      Object.defineProperty(mockFuture, 'onIOPub', {
        set(handler: any) {
          onIOPubHandler = handler;
          setTimeout(() => {
            handler(
              makeStreamMsg(
                progressJson({
                  status: 'progress',
                  message: 'Downloading...',
                  percent: null
                }) + '\n'
              )
            );
            handler(makeStatusMsg('idle'));
          }, 0);
        },
        get() {
          return onIOPubHandler;
        }
      });

      await service.executeKernelSetupCode();

      const progressCall = mockNotificationUpdate.mock.calls.find(
        (c: any[]) => c[0].message === 'Downloading...'
      );
      expect(progressCall).toBeDefined();
      expect(progressCall![0].progress).toBeUndefined();
    });

    it('shows success notification from stream complete message', async () => {
      const mockFuture = {
        onIOPub: null as any,
        done: Promise.resolve()
      };
      mockKernel.requestExecute.mockReturnValue(mockFuture);

      Object.defineProperty(mockFuture, 'onIOPub', {
        set(handler: any) {
          onIOPubHandler = handler;
          setTimeout(() => {
            handler(
              makeStreamMsg(
                progressJson({
                  status: 'complete',
                  message: 'Installation complete'
                }) + '\n'
              )
            );
            handler(makeStatusMsg('idle'));
          }, 0);
        },
        get() {
          return onIOPubHandler;
        }
      });

      await service.executeKernelSetupCode();

      expect(mockNotificationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-123',
          message: 'Installation complete',
          type: 'success',
          autoClose: 5000
        })
      );
    });

    it('does not emit fallback success when complete message already handled', async () => {
      const mockFuture = {
        onIOPub: null as any,
        done: Promise.resolve()
      };
      mockKernel.requestExecute.mockReturnValue(mockFuture);

      Object.defineProperty(mockFuture, 'onIOPub', {
        set(handler: any) {
          onIOPubHandler = handler;
          setTimeout(() => {
            handler(
              makeStreamMsg(
                progressJson({
                  status: 'complete',
                  message: 'Installation complete'
                }) + '\n'
              )
            );
            handler(makeStatusMsg('idle'));
          }, 0);
        },
        get() {
          return onIOPubHandler;
        }
      });

      await service.executeKernelSetupCode();

      const kernelReadyCalls = mockNotificationUpdate.mock.calls.filter(
        (c: any[]) => c[0].message === 'Kernel ready'
      );
      expect(kernelReadyCalls).toHaveLength(0);
    });

    it('shows error notification with Retry on stream error message', async () => {
      const mockFuture = {
        onIOPub: null as any,
        done: Promise.resolve()
      };
      mockKernel.requestExecute.mockReturnValue(mockFuture);

      Object.defineProperty(mockFuture, 'onIOPub', {
        set(handler: any) {
          onIOPubHandler = handler;
          setTimeout(() => {
            handler(
              makeStreamMsg(
                progressJson({
                  status: 'error',
                  message: 'pip install failed'
                }) + '\n'
              )
            );
            handler(makeStatusMsg('idle'));
          }, 0);
        },
        get() {
          return onIOPubHandler;
        }
      });

      await service.executeKernelSetupCode();

      expect(mockNotificationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-123',
          message: 'pip install failed',
          type: 'error',
          autoClose: false,
          actions: expect.arrayContaining([
            expect.objectContaining({ label: 'Retry' })
          ])
        })
      );
    });

    it('shows error notification with Retry on kernel error message type', async () => {
      const mockFuture = {
        onIOPub: null as any,
        done: Promise.resolve()
      };
      mockKernel.requestExecute.mockReturnValue(mockFuture);

      Object.defineProperty(mockFuture, 'onIOPub', {
        set(handler: any) {
          onIOPubHandler = handler;
          setTimeout(() => {
            handler(makeErrorMsg());
          }, 0);
        },
        get() {
          return onIOPubHandler;
        }
      });

      await expect(service.executeKernelSetupCode()).rejects.toThrow(
        'Kernel setup failed'
      );

      expect(mockNotificationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notif-123',
          message: 'Kernel setup failed',
          type: 'error',
          actions: expect.arrayContaining([
            expect.objectContaining({ label: 'Retry' })
          ])
        })
      );
    });

    it('calls kernel.interrupt() when Cancel action is invoked', async () => {
      await service.executeKernelSetupCode();

      const emitCall = mockNotificationEmit.mock.calls[0];
      const cancelAction = emitCall[2].actions[0];
      cancelAction.callback();

      expect(mockKernel.interrupt).toHaveBeenCalled();
    });

    it('ignores non-JSON stream lines', async () => {
      const mockFuture = {
        onIOPub: null as any,
        done: Promise.resolve()
      };
      mockKernel.requestExecute.mockReturnValue(mockFuture);

      Object.defineProperty(mockFuture, 'onIOPub', {
        set(handler: any) {
          onIOPubHandler = handler;
          setTimeout(() => {
            handler(makeStreamMsg('regular output text\n'));
            handler(makeStatusMsg('idle'));
          }, 0);
        },
        get() {
          return onIOPubHandler;
        }
      });

      await service.executeKernelSetupCode();

      // Should only have the initial emit and the final success update
      const progressUpdateCalls = mockNotificationUpdate.mock.calls.filter(
        (c: any[]) =>
          c[0].type === 'in-progress' &&
          c[0].message !== 'Initializing kernel...'
      );
      expect(progressUpdateCalls).toHaveLength(0);
    });

    it('ignores JSON lines without source=osml', async () => {
      const mockFuture = {
        onIOPub: null as any,
        done: Promise.resolve()
      };
      mockKernel.requestExecute.mockReturnValue(mockFuture);

      Object.defineProperty(mockFuture, 'onIOPub', {
        set(handler: any) {
          onIOPubHandler = handler;
          setTimeout(() => {
            handler(
              makeStreamMsg(
                JSON.stringify({ source: 'other', message: 'hello' }) + '\n'
              )
            );
            handler(makeStatusMsg('idle'));
          }, 0);
        },
        get() {
          return onIOPubHandler;
        }
      });

      await service.executeKernelSetupCode();

      const progressUpdateCalls = mockNotificationUpdate.mock.calls.filter(
        (c: any[]) =>
          c[0].type === 'in-progress' &&
          c[0].message !== 'Initializing kernel...'
      );
      expect(progressUpdateCalls).toHaveLength(0);
    });

    it('throws when kernel future cannot be created', async () => {
      mockKernel.requestExecute.mockReturnValue(undefined);

      await expect(service.executeKernelSetupCode()).rejects.toThrow(
        'Failed to create kernel setup future'
      );
    });
  });
});
