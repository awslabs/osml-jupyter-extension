// Copyright Amazon.com, Inc. or its affiliates.

jest.mock('../utils', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

import { CommService } from '../services/CommService';

/**
 * Minimal mock comm: captures the assigned onMsg handler and records sends.
 * `open()` returns a future whose onIOPub/done we do not need for these tests
 * (setup completion is driven through comm.onMsg directly).
 */
function createMockComm() {
  const comm: any = {
    onMsg: (_msg: any) => {},
    isDisposed: false,
    sent: [] as any[],
    send: jest.fn((message: any) => {
      comm.sent.push(message);
      return { done: Promise.resolve() };
    }),
    open: jest.fn(() => ({
      onIOPub: (_msg: any) => {},
      done: Promise.resolve()
    })),
    close: jest.fn()
  };
  return comm;
}

function createMockKernel(comm: any) {
  return {
    createComm: jest.fn(() => comm)
  } as any;
}

/**
 * Deliver a comm message to the service's currently-installed onMsg handler.
 */
function deliver(comm: any, data: any): void {
  comm.onMsg({ content: { data } });
}

/**
 * Initialize a CommService against a fresh mock comm, driving the
 * KERNEL_COMM_SETUP_COMPLETE handshake so the permanent demux is installed.
 */
async function initializedService(): Promise<{
  service: CommService;
  comm: any;
}> {
  const service = new CommService();
  const comm = createMockComm();
  const kernel = createMockKernel(comm);

  const initPromise = service.initialize(kernel);
  // The Promise executor in initialize() ran synchronously, so comm.onMsg is
  // now the setup-handshake handler. Fire the completion message.
  deliver(comm, { type: 'KERNEL_COMM_SETUP_COMPLETE' });
  await initPromise;

  return { service, comm };
}

describe('CommService demultiplexer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes push types to the PushDispatcher', async () => {
    const { service, comm } = await initializedService();
    const dispatch = jest.fn();
    service.setPushDispatcher({ dispatch } as any);

    const setView = { type: 'SET_VIEW', x: 1, y: 2, zoom: 3 };
    deliver(comm, setView);

    expect(dispatch).toHaveBeenCalledWith(setView);
  });

  it('does not route *_RESPONSE messages to the dispatcher', async () => {
    const { service, comm } = await initializedService();
    const dispatch = jest.fn();
    service.setPushDispatcher({ dispatch } as any);

    deliver(comm, { type: 'IMAGE_TILE_RESPONSE', status: 'SUCCESS' });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sendMessageAsync resolves on a terminal response and reports progress', async () => {
    const { service, comm } = await initializedService();
    const onProgress = jest.fn();

    const resultPromise = service.sendMessageAsync(
      { type: 'PYRAMID_BUILD_REQUEST' } as any,
      'PYRAMID_BUILD_RESPONSE',
      600000,
      onProgress
    );

    // Progress messages flow through the permanent demux to the listener.
    deliver(comm, {
      type: 'PYRAMID_BUILD_RESPONSE',
      status: 'PROGRESS',
      level: 1,
      totalLevels: 3,
      percent: 33
    });
    deliver(comm, {
      type: 'PYRAMID_BUILD_RESPONSE',
      status: 'SUCCESS',
      outputPath: '/tmp/out'
    });

    const result = await resultPromise;

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROGRESS', percent: 33 })
    );
    expect(result.status).toBe('SUCCESS');
    expect(result.outputPath).toBe('/tmp/out');
  });

  it('sendMessageAsync does not intercept push messages during its wait', async () => {
    const { service, comm } = await initializedService();
    const dispatch = jest.fn();
    service.setPushDispatcher({ dispatch } as any);

    const resultPromise = service.sendMessageAsync(
      { type: 'PYRAMID_BUILD_REQUEST' } as any,
      'PYRAMID_BUILD_RESPONSE'
    );

    // A push arriving mid-wait must still reach the dispatcher.
    deliver(comm, { type: 'SET_VIEW', x: 0, y: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);

    deliver(comm, { type: 'PYRAMID_BUILD_RESPONSE', status: 'SUCCESS' });
    await resultPromise;
  });

  it('sendOneWay sends without registering a response listener', async () => {
    const { service, comm } = await initializedService();

    service.sendOneWay({ type: 'CLICK_EVENT', x: 10, y: 20 });

    expect(comm.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CLICK_EVENT', x: 10, y: 20 })
    );

    // No lingering listener: a stray CLICK_EVENT response is a no-op (would
    // throw if a listener were mistakenly registered against an undefined cb).
    expect(() =>
      deliver(comm, { type: 'CLICK_EVENT_RESPONSE', status: 'SUCCESS' })
    ).not.toThrow();
  });
});
