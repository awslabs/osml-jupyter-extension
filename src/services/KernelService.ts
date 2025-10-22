// Copyright Amazon.com, Inc. or its affiliates.

import { ServiceManager, KernelMessage } from '@jupyterlab/services';
import {
  ISessionContext,
  SessionContext,
  SessionContextDialogs
} from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { KERNEL_SETUP_CODE } from '../utils';

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
      throw new Error('Session context not available');
    }

    await this.sessionContext.session?.kernel?.restart();
  }

  /**
   * Shutdown the kernel session
   */
  public async shutdown(): Promise<void> {
    if (this.sessionContext?.session) {
      await this.sessionContext.session.shutdown();
    }
  }

  /**
   * Create and initialize session context
   */
  private async createAndInitializeSession(): Promise<void> {
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
      throw new Error('Failed to initialize session context');
    }
  }

  /**
   * Select kernel using dialog
   */
  private async selectKernel(): Promise<void> {
    if (!this.sessionContext) {
      throw new Error('Session context not available');
    }
    await this.sessionContextDialogs.selectKernel(this.sessionContext);
  }

  /**
   * Execute kernel setup code with proper promise handling
   */
  private async executeKernelSetupCode(): Promise<void> {
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
              console.log('Completed kernel setup for JupyterImageLayer');
              resolve();
              break;
            case 'error':
              console.error('Unable to setup kernel for JupyterImageLayer');
              console.error(msg);
              reject(new Error('Kernel setup failed'));
              break;
          }
        };

        kernelSetupFuture.done.catch(error => {
          reject(error);
        });
      });
    }
  }

  /**
   * Initialize the kernel session and setup code
   */
  public async initialize(): Promise<void> {
    // Create and initialize session context
    await this.createAndInitializeSession();

    // Select kernel using dialog
    await this.selectKernel();

    // Execute kernel setup code
    await this.executeKernelSetupCode();

    // Verify kernel is available after initialization
    const kernel = this.sessionContext!.session?.kernel;
    if (!kernel) {
      throw new Error('Kernel not available after initialization');
    }

    console.log('Kernel service initialized successfully.');
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
