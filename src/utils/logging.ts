// Copyright Amazon.com, Inc. or its affiliates.

import { ILoggerRegistry, ITextLog } from '@jupyterlab/logconsole';

/**
 * Singleton logger manager for OSML extension
 */
class OSMLLoggerManager {
  private static instance: OSMLLoggerManager;
  private logger: any = null;
  private isInitialized = false;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): OSMLLoggerManager {
    if (!OSMLLoggerManager.instance) {
      OSMLLoggerManager.instance = new OSMLLoggerManager();
    }
    return OSMLLoggerManager.instance;
  }

  /**
   * Initialize the logger to connect to the JupyterLab logger associated with a specific
   * source in the registry. This is normally a notebook file path but those properties are
   * not always available for generic extensions that build directly on MainAreaWidget. An
   * empty source, '', is the default.
   */
  public bindToSourceLogger(
    loggerRegistry: ILoggerRegistry,
    source: string = ''
  ): void {
    // Debug: Log information about the logger registry
    console.log(
      '[OSML Debug] Logger registry available loggers:',
      loggerRegistry.getLoggers()
    );
    console.log('[OSML Debug] Getting logger for context:', source);

    this.logger = loggerRegistry.getLogger(source);

    this.isInitialized = true;

    console.log(
      '[OSML Debug] Logger initialization complete, isInitialized:',
      this.isInitialized
    );
  }

  /**
   * Check if the logger has been initialized
   */
  public get isLoggerInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Log a debug message
   */
  public debug(message: string): void {
    this.log('debug', message);
  }

  /**
   * Log an info message
   */
  public info(message: string): void {
    this.log('info', message);
  }

  /**
   * Log a warning message
   */
  public warn(message: string): void {
    this.log('warning', message);
  }

  /**
   * Log an error message
   */
  public error(message: string): void {
    this.log('error', message);
  }

  /**
   * Log a critical message
   */
  public critical(message: string): void {
    this.log('critical', message);
  }

  /**
   * Internal log method that creates JupyterLab log messages
   */
  private log(
    level: 'debug' | 'info' | 'warning' | 'error' | 'critical',
    message: string
  ): void {
    if (this.isInitialized && this.logger) {
      console.log(
        '[OSML Debug] Attempting to log message:',
        message,
        'with level:',
        level
      );
      const logMessage: ITextLog = {
        type: 'text',
        level: level as any,
        data: `[OSML] ${message}`
      };
      console.log('[OSML Debug] Created log message object:', logMessage);
      this.logger.log(logMessage);
      console.log('[OSML Debug] Logger.log() called successfully');
    } else {
      console.log(
        '[OSML Debug] Cannot log - logger not initialized or not available'
      );
    }
  }
}

// Export singleton instance for easy access throughout the application
export const logger = OSMLLoggerManager.getInstance();

// Export the class for testing purposes
export { OSMLLoggerManager };
