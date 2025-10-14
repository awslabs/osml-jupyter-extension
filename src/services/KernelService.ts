// Copyright Amazon.com, Inc. or its affiliates.

import { ServiceManager, KernelMessage } from '@jupyterlab/services';
import { ISessionContext, SessionContext, SessionContextDialogs } from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

/**
 * Service for managing Jupyter kernel setup and lifecycle
 */
export class KernelService {
  private sessionContext?: SessionContext;
  private sessionContextDialogs: SessionContextDialogs;
  private translator: ITranslator;
  private isInitialized: boolean = false;

  constructor(private manager: ServiceManager.IManager) {
    this.translator = nullTranslator;
    this.sessionContextDialogs = new SessionContextDialogs({
      translator: this.translator
    });
  }

  /**
   * Initialize the kernel session
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Create a new session to connect to the Jupyter Kernel
    this.sessionContext = new SessionContext({
      sessionManager: this.manager.sessions,
      specsManager: this.manager.kernelspecs,
      name: 'OversightML Image Viewer',
      kernelPreference: { name: 'ipython' }
    });

    await this.sessionContext.initialize();
    
    if (this.sessionContext.session) {
      await this.sessionContextDialogs.selectKernel(this.sessionContext);
      this.isInitialized = true;
    } else {
      throw new Error('Failed to initialize kernel session');
    }
  }

  /**
   * Execute kernel setup code
   */
  public async executeSetupCode(code: string): Promise<void> {
    if (!this.sessionContext?.session?.kernel) {
      throw new Error('Kernel session not available');
    }

    return new Promise((resolve, reject) => {
      const kernelSetupFuture = this.sessionContext!.session!.kernel!.requestExecute({
        code: code
      });

      if (kernelSetupFuture) {
        kernelSetupFuture.onIOPub = (msg: KernelMessage.IIOPubMessage): void => {
          const msgType = msg.header.msg_type;
          switch (msgType) {
            case 'execute_result':
              console.log('Completed kernel setup for OSML Image Viewer');
              resolve();
              break;
            case 'error':
              console.error('Unable to setup kernel for OSML Image Viewer');
              console.error(msg);
              reject(new Error('Kernel setup failed'));
              break;
          }
        };

        kernelSetupFuture.done.catch(error => {
          reject(error);
        });
      } else {
        reject(new Error('Failed to create kernel setup future'));
      }
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
    return this.isInitialized && 
           !!this.sessionContext?.session?.kernel && 
           !this.sessionContext.session.kernel.isDisposed;
  }

  /**
   * Restart the kernel
   */
  public async restart(): Promise<void> {
    if (!this.sessionContext) {
      throw new Error('Session context not available');
    }

    await this.sessionContext.session?.kernel?.restart();
    this.isInitialized = false;
  }

  /**
   * Shutdown the kernel session
   */
  public async shutdown(): Promise<void> {
    if (this.sessionContext?.session) {
      await this.sessionContext.session.shutdown();
    }
    this.isInitialized = false;
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
      this.isInitialized = false;
    } catch (error) {
      console.warn('Exception caught cleaning up kernel service resources:', error);
    }
  }
}
