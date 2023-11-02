import {
  InputDialog,
  ISessionContext,
  SessionContext,
  SessionContextDialogs
} from '@jupyterlab/apputils';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { ServiceManager } from '@jupyterlab/services';

import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
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

  /**
   * Public constructor for the ImageViewerWidget.
   *
   * @param manager Jupyter service manager dependency
   */
  public constructor(manager: ServiceManager.IManager) {
    const content = new Widget();
    super({ content });
    this.id = 'osml-jupyter-extension:image-viewer';
    this.title.label = 'OSML Image View';
    this.title.closable = true;

    this.translator = nullTranslator;

    // Create a new div that will contain the Leaflet managed content. This div will be the full window in the
    // Jupyter tabbed panel.
    this.mapDiv = document.createElement('div');
    this.mapDiv.id = 'map-' + Date.now();
    this.content.node.appendChild(this.mapDiv);
    this.mapControl = undefined;
    this.layersControl = undefined;

    // Create a new session to connect to the Jupyter Kernel that will be providing the image tiles.
    this.imageSessionContext = new SessionContext({
      sessionManager: manager.sessions,
      specsManager: manager.kernelspecs,
      name: 'OversightML Image Viewer'
    });

    this.sessionContextDialogs = new SessionContextDialogs({
      translator: this.translator
    });

    this.imageSessionContext
      .initialize()
      .then(async value => {
        if (value) {
          if (this.imageSessionContext) {
            await this.sessionContextDialogs.selectKernel(
              this.imageSessionContext
            );
          }

          // Once the session is initialized we can ask the user to select an image for display.
          // This widget is not a general full-earth geographic display so a single image must be
          // selected as the base layer.
          const input = await InputDialog.getText({
            title: 'Image Filename',
            okLabel: 'Load'
          });
          if (input.button.accept && input.value) {
            this.openImage(input.value);
          }
        }
      })
      .catch(reason => {
        console.error(
          `Failed to initialize the session in OSML Image Viewer.\n${reason}`
        );
      });
  }

  /**
   * Creates a new Leaflet map containing a base layer for this tiled image.
   *
   * @param imageName the full path of the image on the Jupyter notebook instance.
   */
  private openImage(imageName: string) {
    console.log('DEBUG: ImageViewerWidget.openImage("' + imageName + '")');

    const minZoom = 2;
    const maxZoom = 12;
    const maxNativeZoom = 6;
    const minNativeZoom = 6;
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
      center: [512, 512]
    });

    if (!this.imageSessionContext) {
      return;
    }

    const imageLayer = jupyterImageLayer(this.imageSessionContext, imageName, {
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

    console.log('Shutting down session as part of dispose()');
    this.imageSessionContext?.session?.shutdown();
    this.imageSessionContext?.dispose();
    this.imageSessionContext = undefined;

    super.dispose();
  }
}
