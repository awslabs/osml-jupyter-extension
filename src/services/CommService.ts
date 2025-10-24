// Copyright Amazon.com, Inc. or its affiliates.

import { Kernel } from '@jupyterlab/services';
import { ICommMessage } from '../types';
import { logger } from '../utils';

/**
 * Service for managing Jupyter comm channel communication
 */
export class CommService {
  private comm?: Kernel.IComm;
  private debug: boolean = false;

  constructor(private kernel?: Kernel.IKernelConnection) {}

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
    targetName: string = 'osml_comm_target'
  ): Promise<void> {
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
        this.comm.open('Open comm');
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
