// Copyright Amazon.com, Inc. or its affiliates.

import { ServiceManager, KernelMessage } from '@jupyterlab/services';
import {
  ISessionContext,
  Notification,
  SessionContext,
  SessionContextDialogs
} from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { KERNEL_SETUP_CODE } from '../utils';
import { logger } from '../utils';

/**
 * Structured progress message emitted by the kernel bootstrap script over iopub.
 */
export interface IOsmlProgressMessage {
  source: 'osml';
  stage: string;
  status: 'progress' | 'complete' | 'error';
  message: string;
  percent: number | null;
}

/**
 * Service for managing Jupyter kernel setup and lifecycle
 */
export class KernelService {
  private sessionContext?: SessionContext;
  private sessionContextDialogs: SessionContextDialogs;
  private translator: ITranslator;

  constructor(private manager: ServiceManager.IManager) {
    this.translator = nullTranslator;
    this.sessionContextDialogs = new SessionContextDialogs({
      translator: this.translator
    });
  }

  /**
   * Get the current session context
   */
  public getSessionContext(): ISessionContext | undefined {
    return this.sessionContext;
  }

  /**
   * Get the kernel connection
   */
  public getKernel() {
    return this.sessionContext?.session?.kernel;
  }

  /**
   * Check if the kernel service is ready
   */
  public isReady(): boolean {
    return (
      !!this.sessionContext?.session?.kernel &&
      !this.sessionContext.session.kernel.isDisposed
    );
  }

  /**
   * Restart the kernel
   */
  public async restart(): Promise<void> {
    if (!this.sessionContext) {
      const errorMessage = 'Session context not available for restart';
      logger.error(`KernelService restart failed: ${errorMessage}`);
      throw new Error('Session context not available');
    }

    try {
      logger.info('Restarting kernel session');
      await this.sessionContext.session?.kernel?.restart();
      logger.info('Kernel session restarted successfully');
    } catch (error: any) {
      logger.error(`KernelService restart failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Shutdown the kernel session
   */
  public async shutdown(): Promise<void> {
    if (this.sessionContext?.session) {
      try {
        logger.info('Shutting down kernel session');
        await this.sessionContext.session.shutdown();
        logger.info('Kernel session shutdown successfully');
      } catch (error: any) {
        logger.error(`KernelService shutdown failed: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Create and initialize session context
   */
  private async createAndInitializeSession(): Promise<void> {
    try {
      logger.debug('Creating session context for OversightML Image Viewer');

      // Create a new session to connect to the Jupyter Kernel that will be providing the image tiles.
      this.sessionContext = new SessionContext({
        sessionManager: this.manager.sessions,
        specsManager: this.manager.kernelspecs,
        name: 'OversightML Image Viewer',
        kernelPreference: { name: 'ipython' }
      });

      // Initialize the session context
      const initializeResult = await this.sessionContext.initialize();
      if (!initializeResult) {
        const errorMessage = 'Failed to initialize session context';
        logger.error(`KernelService session creation failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      logger.debug('Session context created and initialized successfully');
    } catch (error: any) {
      logger.error(`KernelService session creation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Select kernel using dialog
   */
  private async selectKernel(): Promise<void> {
    if (!this.sessionContext) {
      const errorMessage = 'Session context not available for kernel selection';
      logger.error(`KernelService kernel selection failed: ${errorMessage}`);
      throw new Error('Session context not available');
    }

    try {
      logger.debug('Selecting kernel via dialog');
      await this.sessionContextDialogs.selectKernel(this.sessionContext);
      logger.debug('Kernel selection completed');
    } catch (error: any) {
      logger.error(`KernelService kernel selection failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse structured OSML progress messages from an iopub stream line.
   * Returns null if the line is not a valid OSML progress message.
   */
  private parseProgressMessage(line: string): IOsmlProgressMessage | null {
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.source === 'osml') {
        return parsed as IOsmlProgressMessage;
      }
    } catch {
      // Not JSON or not an OSML message — ignore
    }
    return null;
  }

  /**
   * Execute kernel setup code with progress notifications.
   *
   * @param notificationId - Optional existing notification ID to update (used for retry).
   */
  public async executeKernelSetupCode(notificationId?: string): Promise<void> {
    try {
      logger.debug('Executing kernel setup code');

      const kernel = this.sessionContext?.session?.kernel;
      const kernelSetupFuture = kernel?.requestExecute({
        code: KERNEL_SETUP_CODE
      });

      if (!kernelSetupFuture) {
        const errorMessage = 'Failed to create kernel setup future';
        logger.error(`KernelService setup failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      let nId = notificationId ?? '';
      let terminalStateReached = false;

      const cancelAction: Notification.IAction = {
        label: 'Cancel',
        callback: () => {
          kernel?.interrupt();
        }
      };

      const retryAction: Notification.IAction = {
        label: 'Retry',
        callback: (event: MouseEvent) => {
          event.preventDefault();
          Notification.update({
            id: nId,
            message: 'Retrying kernel setup...',
            type: 'in-progress',
            actions: [cancelAction]
          });
          this.executeKernelSetupCode(nId);
        }
      };

      if (!nId) {
        nId = Notification.emit('Initializing kernel...', 'in-progress', {
          autoClose: false,
          actions: [cancelAction]
        });
      } else {
        Notification.update({
          id: nId,
          message: 'Initializing kernel...',
          type: 'in-progress',
          actions: [cancelAction]
        });
      }

      await new Promise<void>((resolve, reject) => {
        kernelSetupFuture.onIOPub = (
          msg: KernelMessage.IIOPubMessage
        ): void => {
          const msgType = msg.header.msg_type;
          switch (msgType) {
            case 'stream': {
              const content = msg.content as { text: string };
              const lines = content.text.split('\n');
              for (const line of lines) {
                const progress = this.parseProgressMessage(line);
                if (!progress) {
                  continue;
                }
                if (progress.status === 'progress') {
                  const msg =
                    progress.percent !== null
                      ? `${progress.message} (${progress.percent}%)`
                      : progress.message;
                  Notification.update({
                    id: nId,
                    message: msg,
                    type: 'in-progress',
                    actions: [cancelAction]
                  });
                } else if (progress.status === 'complete') {
                  terminalStateReached = true;
                  Notification.update({
                    id: nId,
                    message: progress.message,
                    type: 'success',
                    autoClose: 5000,
                    actions: []
                  });
                  setTimeout(() => Notification.dismiss(nId), 5000);
                } else if (progress.status === 'error') {
                  terminalStateReached = true;
                  Notification.update({
                    id: nId,
                    message: progress.message,
                    type: 'error',
                    autoClose: false,
                    actions: [retryAction]
                  });
                }
              }
              break;
            }
            case 'execute_result':
              resolve();
              break;
            case 'status': {
              const content = msg.content as any;
              if (content.execution_state === 'idle') {
                resolve();
              }
              break;
            }
            case 'error': {
              const errorMessage = 'Kernel setup code execution failed';
              logger.error(`KernelService setup failed: ${errorMessage}`);
              terminalStateReached = true;
              Notification.update({
                id: nId,
                message: 'Kernel setup failed',
                type: 'error',
                autoClose: false,
                actions: [retryAction]
              });
              reject(new Error('Kernel setup failed'));
              break;
            }
          }
        };

        kernelSetupFuture.done.catch(error => {
          logger.error(
            `KernelService setup code execution failed: ${error.message}`
          );
          reject(error);
        });
      });

      if (!terminalStateReached) {
        Notification.update({
          id: nId,
          message: 'Kernel ready',
          type: 'success',
          autoClose: 5000,
          actions: []
        });
        setTimeout(() => Notification.dismiss(nId), 5000);
      }

      logger.debug('Kernel setup code executed successfully');
    } catch (error: any) {
      logger.error(`KernelService setup code failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize the kernel session and setup code
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('Initializing KernelService');

      // Create and initialize session context
      await this.createAndInitializeSession();

      // Select kernel using dialog
      await this.selectKernel();

      // Execute kernel setup code
      await this.executeKernelSetupCode();

      // Verify kernel is available after initialization
      const kernel = this.sessionContext!.session?.kernel;
      if (!kernel) {
        const errorMessage = 'Kernel not available after initialization';
        logger.error(`KernelService initialization failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      logger.info('KernelService initialized successfully');
    } catch (error: any) {
      logger.error(`KernelService initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Dispose of the kernel service and clean up resources
   */
  public async dispose(): Promise<void> {
    try {
      if (this.sessionContext?.session) {
        await this.sessionContext.session.shutdown();
      }
      this.sessionContext?.dispose();
      this.sessionContext = undefined;
    } catch (error) {
      console.warn(
        'Exception caught cleaning up kernel service resources:',
        error
      );
    }
  }
}
