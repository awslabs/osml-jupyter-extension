// Copyright Amazon.com, Inc. or its affiliates.

import { JupyterFrontEnd } from '@jupyterlab/application';
import { Notification } from '@jupyterlab/apputils';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { Contents, ServiceManager } from '@jupyterlab/services';

import { KernelService } from './services/KernelService';
import { CommService } from './services/CommService';
import { logger } from './utils';

const IMAGE_EXTENSIONS = ['.ntf', '.nitf', '.tif', '.tiff'];
const PYRAMID_BUILD_TIMEOUT_MS = 600000; // 10 minutes

export class BuildPyramidCommand {
  constructor(
    private app: JupyterFrontEnd,
    private manager: ServiceManager.IManager,
    private browser: IFileBrowserFactory | null
  ) {}

  async execute(): Promise<void> {
    const selectedFile = this.getSelectedFilePath();
    if (!selectedFile) {
      return;
    }

    let kernelService: KernelService | null = null;
    let notificationId = '';
    try {
      kernelService = new KernelService(this.manager);
      await kernelService.initialize();

      const kernel = kernelService.getKernel();
      if (!kernel) {
        throw new Error('Kernel not available after initialization');
      }

      const commService = new CommService();
      await commService.initialize(kernel);

      const cancelAction: Notification.IAction = {
        label: 'Cancel',
        callback: () => {
          kernel.interrupt();
        }
      };

      notificationId = Notification.emit('Building pyramid...', 'in-progress', {
        autoClose: false,
        actions: [cancelAction]
      });

      const response = await commService.sendMessageAsync(
        { type: 'PYRAMID_BUILD_REQUEST', dataset: selectedFile },
        'PYRAMID_BUILD_RESPONSE',
        PYRAMID_BUILD_TIMEOUT_MS,
        data => {
          Notification.update({
            id: notificationId,
            message: `Building pyramid: level ${data.level}/${data.totalLevels} (${data.percent}%)`,
            type: 'in-progress',
            actions: [cancelAction]
          });
        }
      );

      if (response.status === 'SUCCESS') {
        Notification.update({
          id: notificationId,
          message: `Pyramid built: ${response.outputPath}`,
          type: 'success',
          autoClose: 5000,
          actions: []
        });
        setTimeout(() => Notification.dismiss(notificationId), 5000);
      } else {
        Notification.update({
          id: notificationId,
          message: `Pyramid build failed: ${response.error || 'Unknown error'}`,
          type: 'error',
          autoClose: false
        });
      }

      commService.dispose();
    } catch (error: any) {
      logger.error(`BuildPyramidCommand failed: ${error.message}`);
      if (notificationId) {
        Notification.update({
          id: notificationId,
          message: `Pyramid build failed: ${error.message}`,
          type: 'error',
          autoClose: false
        });
      } else {
        Notification.emit(`Pyramid build failed: ${error.message}`, 'error', {
          autoClose: false
        });
      }
    } finally {
      if (kernelService) {
        await kernelService.dispose();
      }
    }
  }

  public isVisible(): boolean {
    const selectedFiles = this.getSelectedFiles();
    if (selectedFiles.length === 0) {
      return false;
    }

    return selectedFiles.some(file => {
      const fileName = file.name.toLowerCase();
      return IMAGE_EXTENSIONS.some(ext => fileName.endsWith(ext));
    });
  }

  private getSelectedFilePath(): string | null {
    const widget = this.browser?.tracker.currentWidget;
    if (widget) {
      const firstItem = widget.selectedItems().next();
      return String(firstItem.value?.path ?? '');
    }
    return null;
  }

  private getSelectedFiles(): Contents.IModel[] {
    const widget = this.browser?.tracker.currentWidget;
    if (!widget) {
      return [];
    }
    return Array.from(widget.selectedItems());
  }
}
