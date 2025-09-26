import {
  ISessionContext,
  SessionContext,
  SessionContextDialogs
} from '@jupyterlab/apputils';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { Kernel, KernelMessage, ServiceManager } from '@jupyterlab/services';

import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import { Signal } from '@lumino/signaling';
import { MainAreaWidget } from '@jupyterlab/apputils';
import {
  Control,
  Map,
  CRS,
  Transformation,
  control,
  map,
  extend
} from 'leaflet';

import { jupyterImageLayer } from './JupyterImageLayer';
import { jupyterOverlayLayer } from './JupyterOverlayLayer';
import { KERNEL_SETUP_CODE } from './kernelSetupCode';

/**
 * This widget provides a way to display geospatial information in a Jupyter environment overlaid on an image.
 */
export class ImageViewerWidget extends MainAreaWidget {
  private imageSessionContext?: SessionContext;
  private sessionContextDialogs: SessionContextDialogs;
  private translator: ITranslator;
  private mapDiv: HTMLDivElement;
  private mapControl?: Map;
  private layersControl?: Control.Layers;
  private comm?: Kernel.IComm;
  private imageName?: string;
  private manager?: ServiceManager.IManager;

  /**
   * Static Factory Method for the ImageViewerWidget.
   *
   * On creation this widget injects code into a Python Kernel that establishes the server side of a "comm" channel
   * and sets up tile readers / vector indexes based on the osml-imagery-toolkit. These resources will be accessed
   * by custom messages sent by layers added to the map.
   *
   * @param manager Jupyter service manager dependency
   * @param selectedFileName Path of the selected file on the local file system
   */
  public static async createForImage(
    manager: ServiceManager.IManager,
    selectedFileName: string | null
  ): Promise<ImageViewerWidget> {
    const widget = new ImageViewerWidget(manager);
    await widget.initialize(selectedFileName);
    return widget;
  }

  public constructor(manager: ServiceManager.IManager) {
    const content = new Widget();
    super({ content });
    this.id = 'osml-jupyter-extension:image-viewer';
    this.title.label = 'OSML Image View';
    this.title.closable = true;

    this.manager = manager;

    this.translator = nullTranslator;

    // Create a new session to connect to the Jupyter Kernel that will be providing the image tiles.
    this.imageSessionContext = new SessionContext({
      sessionManager: this.manager.sessions,
      specsManager: this.manager.kernelspecs,
      name: 'OversightML Image Viewer',
      kernelPreference: { name: 'ipython' }
    });

    this.sessionContextDialogs = new SessionContextDialogs({
      translator: this.translator
    });

    // Create a new div that will contain the Leaflet managed content. This div will be the full window in the
    // Jupyter tabbed panel.
    this.mapDiv = document.createElement('div');
    this.mapDiv.id = 'map-' + Date.now();
    this.content.node.appendChild(this.mapDiv);
    this.mapControl = undefined;
    this.layersControl = undefined;
  }

  private async initialize(selectedFileName: string | null) {
    if (!this.imageSessionContext) {
      return;
    }

    this.imageSessionContext
      .initialize()
      .then(async value => {
        if (value) {
          if (this.imageSessionContext) {
            await this.sessionContextDialogs.selectKernel(
              this.imageSessionContext
            );

            // Install the code on the Jupyter session needed to create tiles and setup the server side of the comm
            // channel.
            const kernelSetupFuture =
              this.imageSessionContext.session?.kernel?.requestExecute({
                code: KERNEL_SETUP_CODE
              });
            if (kernelSetupFuture) {
              kernelSetupFuture.onIOPub = function (
                msg: KernelMessage.IIOPubMessage
              ): void {
                const msgType = msg.header.msg_type;
                switch (msgType) {
                  case 'execute_result':
                    console.log('Completed kernel setup for JupyterImageLayer');
                    break;
                  case 'error':
                    console.error(
                      'Unable to setup kernel for JupyterImageLayer'
                    );
                    console.error(msg);
                    break;
                }
              };
            }

            // Create the client side of the comm channel.
            console.log('Setting up new comm!');
            this.comm =
              this.imageSessionContext.session?.kernel?.createComm(
                'osml_comm_target'
              );
            if (this.comm) {
              this.comm.open('Open comm');
            }
            console.log('Comm setup completed.');
          }

          // Once the session is initialized we can ask the user to select an image for display.
          // This widget is not a general full-earth geographic display so a single image must be
          // selected as the base layer.

          if (selectedFileName) {
            await this.openImage(selectedFileName);
          }
        }
      })
      .catch(reason => {
        console.error(
          `Failed to initialize the session in OSML Image Viewer.\n${reason}`
        );
      });
  }

  public statusSignal: Signal<any, any> = new Signal<any, any>(this);

  /**
   * Creates a new Leaflet map containing a base layer for this tiled image.
   *
   * @param imageName the full path of the image on the Jupyter notebook instance.
   */
  public async openImage(imageName: string | null) {
    console.log('DEBUG: ImageViewerWidget.openImage("' + imageName + '")');
    if (!imageName) {
      return;
    }

    if (!this.comm) {
      this.statusSignal.emit(
        `Unable to load ${imageName} because plugin setup failed.`
      );
      return;
    }

    try {
      this.statusSignal.emit(`Loading ${imageName} ...`);
      const loadStatus = await new Promise<string>((resolve, reject) => {
        const commFuture = this.comm!.send({
          type: 'IMAGE_LOAD_REQUEST',
          dataset: imageName
        });

        // Set a timeout to reject the promise if we don't get a response
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout waiting for image load response'));
        }, 30000); // 30 second timeout

        commFuture.onIOPub = (msg: any): void => {
          const msgType = msg.header.msg_type;
          if (msgType === 'comm_msg') {
            console.log('Received image load response from comm!!!');
            clearTimeout(timeoutId);
            resolve(msg.content.data.status);
          }
        };

        // Handle comm future done with error
        commFuture.done.catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
      });

      this.statusSignal.emit(`Loading ${imageName} ... ${loadStatus}`);
    } catch (error: any) {
      console.error('Error loading image:', error);
      this.statusSignal.emit(`Error loading ${imageName}: ${error.message}`);
    }

    this.imageName = imageName;
    const minZoom = 0;
    const maxZoom = 16;
    const maxNativeZoom = 12;
    const minNativeZoom = 0;
    const customCRS = extend({}, CRS.Simple, {
      transformation: new Transformation(
        1 / 2 ** maxNativeZoom,
        0,
        1 / 2 ** maxNativeZoom,
        0
      )
    });
    this.mapControl = map(this.mapDiv.id, {
      crs: customCRS,
      minZoom: minZoom,
      maxZoom: maxZoom,
      zoom: maxNativeZoom,
      center: [512, 512],
      attributionControl: false
    });

    if (!this.imageSessionContext || !this.comm) {
      return;
    }

    const imageLayer = jupyterImageLayer(this.comm, imageName, {
      tileSize: 512,
      minNativeZoom: minNativeZoom,
      maxNativeZoom: maxNativeZoom
    });
    this.mapControl.addLayer(imageLayer);

    const baseLayers: any = {};
    baseLayers[imageName] = imageLayer;

    const overlayLayers = {};
    this.layersControl = control.layers(baseLayers, overlayLayers);
    this.mapControl.addControl(this.layersControl);

    return;
  }

  public addLayer(layerDataPath: string | null) {
    if (!layerDataPath || !this.imageName) {
      return;
    }

    this.statusSignal.emit(`Adding overlays from ${layerDataPath}`);
    const maxNativeZoom = 12;
    const minNativeZoom = 12;
    const overlayLayer = jupyterOverlayLayer(
      this.comm,
      this.imageName,
      layerDataPath,
      {
        tileSize: 512,
        minNativeZoom: minNativeZoom,
        maxNativeZoom: maxNativeZoom
      }
    );
    if (this.mapControl && this.layersControl) {
      this.mapControl.addLayer(overlayLayer);
      this.layersControl.addOverlay(overlayLayer, layerDataPath);
    }
    return;
  }

  /**
   * Returns the current kernel session providing access to image tiles.
   */
  get session(): ISessionContext | undefined {
    return this.imageSessionContext;
  }

  /**
   * Handler triggered when a user closes the main area window containing this widget. Implementation expands on the
   * super's implementation to ensure class specific resources are cleaned up.
   *
   * @param msg the lumino message
   * @protected
   */
  protected onCloseRequest(msg: Message): void {
    console.log('onCloseRequest for ImageViewerWidget');
    super.onCloseRequest(msg);
    this.dispose();
  }

  /**
   * Implementation expand the super's dispose function to ensure class specific resources are cleaned up.
   */
  dispose(): void {
    if (this.mapDiv) {
      this.mapDiv.innerHTML = '';
    }
    this.mapControl = undefined;

    console.log('Shutting down session and comm as part of dispose()');
    try {
      this.comm?.close();
      this.imageSessionContext?.session?.shutdown();
      this.imageSessionContext?.dispose();
      this.imageSessionContext = undefined;
    } catch (e) {
      console.warn('Exception caught cleaning up session and comm resources');
      console.debug(e);
    }

    super.dispose();
  }
}
