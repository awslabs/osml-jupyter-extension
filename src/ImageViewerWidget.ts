import {
  ISessionContext,
  SessionContext,
  SessionContextDialogs
} from '@jupyterlab/apputils';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { Kernel, KernelMessage, ServiceManager } from '@jupyterlab/services';

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
import { jupyterOverlayLayer } from './JupyterOverlayLayer';

/**
 * This is the Python code that the extension installs in a newly launched kernel to provide access to raster and vector
 * tiles. The code itself is sent to the kernel by calling requestExecute() and as it runs it sets up the server side
 * of the comm messaging handlers. It is only a MVP prototype for now and we will need to look for best practices
 * about how to manage this code going forward.
 */
const KERNEL_SETUP_CODE: string = `
from osgeo import gdal, gdalconst
gdal.UseExceptions()

from aws.osml.gdal import load_gdal_dataset, GDALImageFormats, GDALCompressionOptions, RangeAdjustmentType
from aws.osml.image_processing import GDALTileFactory
from aws.osml.features import STRFeature2DSpatialIndex, ImagedFeaturePropertyAccessor
from math import ceil, log

import base64
import geojson
import shapely
import os

def get_standard_overviews(width: int, height: int, preview_size: int):
    min_side = min(width, height)
    num_overviews = ceil(log(min_side / preview_size) / log(2))
    if num_overviews > 0:
        result = []
        for i in range(1, num_overviews + 1):
            result.append(2**i)
        return result
    return []

image_tile_factory_cache = {}
def get_image_tile_factory(dataset):
    if dataset not in image_tile_factory_cache.keys():
        ds, sensor_model = load_gdal_dataset(dataset)
        band = ds.GetRasterBand(1)
        overview_count = band.GetOverviewCount()
        if overview_count == 0:
            overviews = get_standard_overviews(ds.RasterXSize, ds.RasterYSize, 1024)
            ds.BuildOverviews("CUBIC", overviews)
        viz_tile_factory = GDALTileFactory(ds,
                                           sensor_model,
                                           GDALImageFormats.PNG,
                                           GDALCompressionOptions.NONE,
                                           output_type=gdalconst.GDT_Byte,
                                           range_adjustment=RangeAdjustmentType.DRA)
        image_tile_factory_cache[dataset] = viz_tile_factory
    return image_tile_factory_cache.get(dataset)

overlay_tile_factory_cache = {}
def get_overlay_tile_factory(image_name, overlay_name):
    key = f"{image_name}:{overlay_name}"
    if key not in overlay_tile_factory_cache.keys():
        with open(overlay_name,"r") as geojson_file:
            fc = geojson.load(geojson_file)
        
        # This workaround ensures all features have the imageGeometry property
        accessor = ImagedFeaturePropertyAccessor()
        for f in fc['features']:
            geom = accessor.find_image_geometry(f)
            accessor.set_image_geometry(f, geom)
                
        tile_index = STRFeature2DSpatialIndex(fc, use_image_geometries=True)
        overlay_tile_factory_cache[key] = tile_index    
    return overlay_tile_factory_cache.get(key)
        
def get_image_tile(dataset, zoom, row, col):
    tile_factory = get_image_tile_factory(dataset)
    print(base64.b64encode(tile_factory.create_encoded_tile([int(col)*512, int(row)*512, 512, 512])).decode('utf-8'))

def create_recv(comm):
    def _recv(msg):
        # Use msg['content']['data'] for the data in the message
        # print(msg['content']['data'])
        type = msg['content']['data']['type']
        
        if type == 'IMAGE_TILE_REQUEST':
            dataset = msg['content']['data']['dataset']
            zoom = msg['content']['data']['zoom']
            row = msg['content']['data']['row']
            col = msg['content']['data']['col']
            max_native_zoom = 12
            scale = 2**(max_native_zoom - zoom)
            scaled_tile_size = 512*scale
            tile_factory = get_image_tile_factory(dataset)
            if tile_factory is not None:
                comm.send({
                    'type': "IMAGE_TILE_RESPONSE",
                    'img': base64.b64encode(tile_factory.create_encoded_tile([
                    int(col)*scaled_tile_size, 
                    int(row)*scaled_tile_size, 
                    scaled_tile_size, 
                    scaled_tile_size], [512, 512])).decode('utf-8')
                })
        elif type == 'OVERLAY_TILE_REQUEST':
            image_name = msg['content']['data']['imageName']
            overlay_name = msg['content']['data']['overlayName']
            zoom = msg['content']['data']['zoom']
            row = msg['content']['data']['row']
            col = msg['content']['data']['col']
            tile_factory = get_overlay_tile_factory(image_name, overlay_name)
            if tile_factory is not None:
                comm.send({
                    'type': "OVERLAY_TILE_RESPONSE",
                    'features': tile_factory.find_intersects(shapely.box(int(col)*512, int(row)*512, (int(col)+1)*512, (int(row)+1)*512))
                })
    return _recv    

osml_comm = None
def osml_comm_target_func(comm, msg):
    # comm is the kernel Comm instance
    # msg is the comm_open message

    osml_comm = comm
    
    # Register handler for later messages
    comm.on_msg(create_recv(comm))

    # Send data to the frontend
    comm.send({'type': "KERNEL_COMM_SETUP_COMPLETE"})

get_ipython().kernel.comm_manager.register_target('osml_comm_target', osml_comm_target_func)

"osml-jupyter-extension:JupyterImageLayer:KERNEL_SETUP_COMPLETE"
`;

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

  /**
   * Public constructor for the ImageViewerWidget.
   *
   * On creation this widget injects code into a Python Kernel that establishes the server side of a "comm" channel
   * and sets up tile readers / vector indexes based on the osml-imagery-toolkit. These resources will be accessed
   * by custom messages sent by layers added to the map.
   *
   * @param manager Jupyter service manager dependency
   * @param selectedFileName Path of the selected file on the local file system
   */
  public constructor(
    manager: ServiceManager.IManager,
    selectedFileName: string | null
  ) {
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
      name: 'OversightML Image Viewer',
      kernelPreference: { name: 'ipython' }
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
            this.openImage(selectedFileName);
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
  public openImage(imageName: string | null) {
    console.log('DEBUG: ImageViewerWidget.openImage("' + imageName + '")');
    if (!imageName) {
      return;
    }

    this.imageName = imageName;
    const minZoom = 2;
    const maxZoom = 12;
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
    console.log(`TODO: Add Layer for ${layerDataPath}`);
    if (!layerDataPath || !this.imageName) {
      return;
    }

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
