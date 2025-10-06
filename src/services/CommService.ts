import { Kernel } from '@jupyterlab/services';
import { CommMessage, CommMessageType } from '../types';

/**
 * Service for managing Jupyter comm channel communication
 */
export class CommService {
  private comm?: Kernel.IComm;
  private messageHandlers: Map<CommMessageType, (message: any) => void> = new Map();
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
  public async initialize(targetName: string = 'osml_comm_target'): Promise<void> {
    if (!this.kernel) {
      throw new Error('Kernel connection not available');
    }

    if (this.debug) {
      console.log(`[CommService] Initializing comm channel with target: ${targetName}`);
    }

    this.comm = this.kernel.createComm(targetName);
    if (this.comm) {
      this.comm.open('Open comm');
      this.setupMessageHandling();
      
      if (this.debug) {
        console.log('[CommService] Comm channel initialized successfully');
      }
    }
  }

  /**
   * Send a message through the comm channel
   */
  public async sendMessage(message: CommMessage): Promise<any> {
    if (!this.comm) {
      throw new Error('Comm channel not initialized');
    }

    if (this.debug) {
      console.log('[CommService] Sending message:', JSON.stringify(message, null, 2));
    }

    return new Promise((resolve, reject) => {
      const commFuture = this.comm!.send(message as any);
      
      const timeoutId = setTimeout(() => {
        if (this.debug) {
          console.warn(`[CommService] Timeout waiting for response to ${message.type}`);
        }
        reject(new Error(`Timeout waiting for response to ${message.type}`));
      }, 30000); // 30 second timeout

      commFuture.onIOPub = (msg: any): void => {
        const msgType = msg.header.msg_type;
        if (msgType === 'comm_msg') {
          const responseData = msg.content.data;
          
          if (this.debug) {
            console.log('[CommService] Received response:', JSON.stringify(responseData, null, 2));
          }
          
          // Always log responses with non-SUCCESS status, even when debug is off
          if (responseData?.status && responseData.status !== 'SUCCESS') {
            console.error('[CommService] Received response with error status:', JSON.stringify(responseData, null, 2));
          }
          
          clearTimeout(timeoutId);
          resolve(responseData);
        }
      };

      commFuture.done.catch(error => {
        clearTimeout(timeoutId);
        if (this.debug) {
          console.error('[CommService] Send message error:', error);
        }
        reject(error);
      });
    });
  }

  /**
   * Register a message handler for a specific message type
   */
  public onMessage(messageType: CommMessageType, handler: (message: any) => void): void {
    if (this.debug) {
      console.log(`[CommService] Registering message handler for type: ${messageType}`);
    }
    this.messageHandlers.set(messageType, handler);
  }

  /**
   * Remove a message handler
   */
  public offMessage(messageType: CommMessageType): void {
    if (this.debug) {
      console.log(`[CommService] Removing message handler for type: ${messageType}`);
    }
    this.messageHandlers.delete(messageType);
  }

  /**
   * Setup message handling for the comm channel
   */
  private setupMessageHandling(): void {
    if (!this.comm) return;

    this.comm.onMsg = (msg: any) => {
      const messageType = msg.content?.data?.type;
      const messageData = msg.content.data;
      
      if (this.debug) {
        console.log('[CommService] Received message:', JSON.stringify(messageData, null, 2));
      }
      
      // Always log messages with non-SUCCESS status, even when debug is off
      if (messageData?.status && messageData.status !== 'SUCCESS') {
        console.error('[CommService] Received message with error status:', JSON.stringify(messageData, null, 2));
      }
      
      if (messageType && this.messageHandlers.has(messageType)) {
        const handler = this.messageHandlers.get(messageType);
        if (handler) {
          if (this.debug) {
            console.log(`[CommService] Calling handler for message type: ${messageType}`);
          }
          handler(messageData);
        }
      } else if (this.debug && messageType) {
        console.warn(`[CommService] No handler registered for message type: ${messageType}`);
      }
    };
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
    this.messageHandlers.clear();
  }
}
