// Copyright Amazon.com, Inc. or its affiliates.

import { Kernel } from '@jupyterlab/services';
import {
  ICommMessage,
  IViewStateUpdateMessage,
  IClickEventMessage,
  PUSH_MESSAGE_TYPES
} from '../types';
import { PushDispatcher } from './PushDispatcher';
import { logger } from '../utils';

/**
 * A fire-and-forget message that expects no `*_RESPONSE`. Either a typed
 * state-stream message (`VIEW_STATE_UPDATE`, `CLICK_EVENT`) or any other object
 * with a `type` discriminator.
 */
export type IOneWayMessage =
  | IViewStateUpdateMessage
  | IClickEventMessage
  | { type: string; [key: string]: unknown };

/**
 * Callback registered against a response `type` by `sendMessageAsync`. Invoked
 * by the permanent demultiplexer for each matching kernel message.
 */
type ResponseListener = (data: any) => void;

/**
 * Service for managing Jupyter comm channel communication
 */
export class CommService {
  private comm?: Kernel.IComm;
  private debug: boolean = false;
  private kernel?: Kernel.IKernelConnection;

  /**
   * Routes kernel-initiated push messages. Wired after construction (the
   * dispatcher needs the viewer widget, which is built after this service).
   */
  private pushDispatcher?: PushDispatcher;

  /**
   * Listener-registration correlation layer for background-thread responses
   * (e.g. the pyramid progress path). Keyed by response `type`.
   */
  private responseListeners: Map<string, ResponseListener> = new Map();

  constructor() {}

  /**
   * Register the dispatcher that handles kernel-initiated push messages.
   */
  public setPushDispatcher(dispatcher: PushDispatcher): void {
    this.pushDispatcher = dispatcher;
  }

  /**
   * Enable or disable debug logging for comm messages
   */
  public setDebugMode(enabled: boolean): void {
    this.debug = enabled;
    if (enabled) {
      console.log('[CommService] Debug logging enabled');
    }
  }

  /**
   * Check if debug logging is enabled
   */
  public isDebugEnabled(): boolean {
    return this.debug;
  }

  /**
   * Initialize the comm channel
   */
  public async initialize(
    kernel: Kernel.IKernelConnection,
    targetName: string = 'osml_comm_target'
  ): Promise<void> {
    this.kernel = kernel;

    if (!this.kernel) {
      const errorMessage = 'Kernel connection not available';
      logger.error(`CommService initialization failed: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    try {
      logger.debug(`Initializing comm channel with target: ${targetName}`);

      if (this.debug) {
        console.log(
          `[CommService] Initializing comm channel with target: ${targetName}`
        );
      }

      this.comm = this.kernel.createComm(targetName);
      if (this.comm) {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error('Timeout waiting for KERNEL_COMM_SETUP_COMPLETE'));
          }, 30000);

          let resolved = false;
          const onComplete = (): void => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);
              this.installPermanentDemux();
              resolve();
            }
          };

          this.comm!.onMsg = (msg: any): void => {
            const data = msg.content?.data;
            if (data?.type === 'KERNEL_COMM_SETUP_COMPLETE') {
              onComplete();
            }
          };

          const openFuture = this.comm!.open('Open comm');

          openFuture.onIOPub = (msg: any): void => {
            if (
              msg.header.msg_type === 'comm_msg' &&
              msg.content?.data?.type === 'KERNEL_COMM_SETUP_COMPLETE'
            ) {
              onComplete();
            }
          };

          openFuture.done.catch(error => {
            if (!resolved) {
              clearTimeout(timeoutId);
              reject(error);
            }
          });
        });

        logger.info(
          `CommService initialized successfully with target: ${targetName}`
        );

        if (this.debug) {
          console.log('[CommService] Comm channel initialized successfully');
        }
      } else {
        const errorMessage = 'Failed to create comm channel';
        logger.error(`CommService initialization failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      logger.error(`CommService initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Install the single permanent `comm.onMsg` demultiplexer. Every subsequent
   * kernel message is routed by inspecting `data.type`:
   *
   * - Push types (`ADD_LAYER`, `SET_VIEW`, …) go to the `PushDispatcher`.
   * - Everything else (`*_RESPONSE`) goes to any registered response listener
   *   (the `sendMessageAsync` correlation layer).
   *
   * Push types and `*_RESPONSE` types are disjoint, so this parallel inbound
   * lane coexists with request/response without touching the tile-fetch hot
   * path (which uses per-send-future `onIOPub` in `sendMessage`).
   */
  private installPermanentDemux(): void {
    if (!this.comm) {
      return;
    }

    this.comm.onMsg = (msg: any): void => {
      const data = msg.content?.data;
      const type: string | undefined = data?.type;
      if (!type) {
        return;
      }

      if (this.debug) {
        console.log(`[CommService] Demux received message type: ${type}`);
      }

      // Push channel: route render commands to the dispatcher.
      if (PUSH_MESSAGE_TYPES.has(type as any)) {
        if (this.pushDispatcher) {
          this.pushDispatcher.dispatch(data);
        } else {
          logger.debug(
            `CommService received push ${type} but no dispatcher is registered`
          );
        }
        return;
      }

      // Correlation layer: deliver to a registered response listener.
      const listener = this.responseListeners.get(type);
      if (listener) {
        listener(data);
      }
    };
  }

  /**
   * Send a message through the comm channel
   */
  public async sendMessage(
    message: ICommMessage,
    timeoutMs: number = 30000
  ): Promise<any> {
    if (!this.comm) {
      const errorMessage = 'Comm channel not initialized';
      logger.error(`CommService sendMessage failed: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    if (this.debug) {
      console.log(
        '[CommService] Sending message:',
        JSON.stringify(message, null, 2)
      );
      console.log(
        `[CommService] Using timeout: ${timeoutMs}ms for message type: ${message.type}`
      );
    }

    return new Promise((resolve, reject) => {
      const commFuture = this.comm!.send(message as any);

      const timeoutId = setTimeout(() => {
        const timeoutError = `Timeout (${timeoutMs}ms) waiting for response to ${message.type}`;
        logger.error(`CommService timeout: ${timeoutError}`);

        if (this.debug) {
          console.warn(`[CommService] ${timeoutError}`);
        }
        reject(new Error(`Timeout waiting for response to ${message.type}`));
      }, timeoutMs);

      commFuture.onIOPub = (msg: any): void => {
        const msgType = msg.header.msg_type;
        if (msgType === 'comm_msg') {
          const responseData = msg.content.data;

          if (this.debug) {
            console.log(
              '[CommService] Received response:',
              JSON.stringify(responseData, null, 2)
            );
          }

          // Log responses with non-SUCCESS status
          if (responseData?.status && responseData.status !== 'SUCCESS') {
            logger.error(
              `CommService received error response for ${message.type}: ${responseData.status} - ${responseData.error || 'Unknown error'}`
            );
            console.error(
              '[CommService] Received response with error status:',
              JSON.stringify(responseData, null, 2)
            );
          }

          clearTimeout(timeoutId);
          resolve(responseData);
        }
      };

      commFuture.done.catch(error => {
        clearTimeout(timeoutId);
        logger.error(
          `CommService send message failed for ${message.type}: ${error.message}`
        );

        if (this.debug) {
          console.error('[CommService] Send message error:', error);
        }
        reject(error);
      });
    });
  }

  /**
   * Send a message and wait for a response delivered via comm.onMsg
   * (for responses sent from background threads in the kernel).
   * Resolves on a terminal status (SUCCESS or ERROR). Calls onProgress
   * for intermediate PROGRESS messages.
   */
  public async sendMessageAsync(
    message: ICommMessage,
    responseType: string,
    timeoutMs: number = 600000,
    onProgress?: (data: any) => void
  ): Promise<any> {
    if (!this.comm) {
      throw new Error('Comm channel not initialized');
    }

    return new Promise((resolve, reject) => {
      // Register a response-type listener with the permanent demux rather than
      // hijacking comm.onMsg. The demux dispatches matching messages here.
      const cleanup = (): void => {
        clearTimeout(timeoutId);
        this.responseListeners.delete(responseType);
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${responseType}`));
      }, timeoutMs);

      this.responseListeners.set(responseType, (responseData: any) => {
        if (responseData?.status === 'PROGRESS') {
          if (onProgress) {
            onProgress(responseData);
          }
        } else {
          cleanup();
          resolve(responseData);
        }
      });

      this.comm!.send(message as any);
    });
  }

  /**
   * Send a fire-and-forget message. Calls `comm.send()` without registering a
   * correlation future or response listener — the kernel updates its state
   * silently and emits no `*_RESPONSE`. Used by the inbound state stream
   * (`VIEW_STATE_UPDATE`, `CLICK_EVENT`) to keep the hot path cheap.
   */
  public sendOneWay(message: IOneWayMessage): void {
    if (!this.comm) {
      logger.error('CommService sendOneWay failed: comm not initialized');
      return;
    }

    if (this.debug) {
      console.log(`[CommService] sendOneWay: ${message.type}`);
    }

    this.comm.send(message as any);
  }

  /**
   * Check if comm is available and ready
   */
  public isReady(): boolean {
    return !!this.comm && !this.comm.isDisposed;
  }

  /**
   * Close the comm channel
   */
  public dispose(): void {
    if (this.debug) {
      console.log('[CommService] Disposing comm service');
    }

    if (this.comm && !this.comm.isDisposed) {
      this.comm.close();
      if (this.debug) {
        console.log('[CommService] Comm channel closed');
      }
    }
  }
}
