// Copyright Amazon.com, Inc. or its affiliates.

import { ServiceManager, KernelMessage } from '@jupyterlab/services';
import {
  ISessionContext,
  SessionContext,
  SessionContextDialogs
} from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { KERNEL_SETUP_CODE } from '../utils';
import { logger } from '../utils';

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
   * Execute kernel setup code with proper promise handling
   */
  private async executeKernelSetupCode(): Promise<void> {
    try {
      logger.debug('Executing kernel setup code');

      // Install the code on the Jupyter session needed to create tiles and setup the server side of the comm channel.
      const kernelSetupFuture =
        this.sessionContext?.session?.kernel?.requestExecute({
          code: KERNEL_SETUP_CODE
        });

      if (kernelSetupFuture) {
        await new Promise<void>((resolve, reject) => {
          kernelSetupFuture.onIOPub = function (
            msg: KernelMessage.IIOPubMessage
          ): void {
            const msgType = msg.header.msg_type;
            switch (msgType) {
              case 'execute_result':
                resolve();
                break;
              case 'error': {
                const errorMessage = 'Kernel setup code execution failed';
                logger.error(`KernelService setup failed: ${errorMessage}`);
                console.error('Unable to setup kernel for JupyterImageLayer');
                console.error(msg);
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

        logger.debug('Kernel setup code executed successfully');
      } else {
        const errorMessage = 'Failed to create kernel setup future';
        logger.error(`KernelService setup failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }
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
  public dispose(): void {
    try {
      if (this.sessionContext?.session) {
        this.sessionContext.session.shutdown();
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
