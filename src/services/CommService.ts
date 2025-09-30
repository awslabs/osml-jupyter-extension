import { Kernel } from '@jupyterlab/services';
import { CommMessage, CommMessageType } from '../types';

/**
 * Service for managing Jupyter comm channel communication
 */
export class CommService {
  private comm?: Kernel.IComm;
  private messageHandlers: Map<CommMessageType, (message: any) => void> = new Map();

  constructor(private kernel?: Kernel.IKernelConnection) {}

  /**
   * Initialize the comm channel
   */
  public async initialize(targetName: string = 'osml_comm_target'): Promise<void> {
    if (!this.kernel) {
      throw new Error('Kernel connection not available');
    }

    this.comm = this.kernel.createComm(targetName);
    if (this.comm) {
      this.comm.open('Open comm');
      this.setupMessageHandling();
    }
  }

  /**
   * Send a message through the comm channel
   */
  public async sendMessage(message: CommMessage): Promise<any> {
    if (!this.comm) {
      throw new Error('Comm channel not initialized');
    }

    return new Promise((resolve, reject) => {
      const commFuture = this.comm!.send(message as any);
      
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for response to ${message.type}`));
      }, 30000); // 30 second timeout

      commFuture.onIOPub = (msg: any): void => {
        const msgType = msg.header.msg_type;
        if (msgType === 'comm_msg') {
          clearTimeout(timeoutId);
          resolve(msg.content.data);
        }
      };

      commFuture.done.catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Register a message handler for a specific message type
   */
  public onMessage(messageType: CommMessageType, handler: (message: any) => void): void {
    this.messageHandlers.set(messageType, handler);
  }

  /**
   * Remove a message handler
   */
  public offMessage(messageType: CommMessageType): void {
    this.messageHandlers.delete(messageType);
  }

  /**
   * Setup message handling for the comm channel
   */
  private setupMessageHandling(): void {
    if (!this.comm) return;

    this.comm.onMsg = (msg: any) => {
      const messageType = msg.content?.data?.type;
      if (messageType && this.messageHandlers.has(messageType)) {
        const handler = this.messageHandlers.get(messageType);
        if (handler) {
          handler(msg.content.data);
        }
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
    if (this.comm && !this.comm.isDisposed) {
      this.comm.close();
    }
    this.messageHandlers.clear();
  }
}
