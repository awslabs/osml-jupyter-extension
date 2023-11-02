import { Coords, DoneCallback, GridLayer, setOptions } from 'leaflet';
import { IJupyterImageLayerOptions } from './IJupyterImageLayerOptions';
import { SessionContext } from '@jupyterlab/apputils';

/**
 * This is the Python code that the extension installs in a newly launched kernel to provide access to image tiles.
 * The code itself is sent to the kernel by calling requestExecute() and as it runs it sets up the server side of the
 * comm messaging handlers. It is only a MVP prototype for now and we will need to look for best practices about how
 * to manage this code going forward.
 */
const KERNEL_SETUP_CODE: string = `
from osgeo import gdal, gdalconst
gdal.UseExceptions()

from aws.osml.gdal import load_gdal_dataset, GDALImageFormats, GDALCompressionOptions, RangeAdjustmentType
from aws.osml.image_processing import GDALTileFactory

import base64
import geojson
import os

tile_factory_cache = {}
def get_tile_factory(dataset):
    if dataset not in tile_factory_cache.keys():
        ds, sensor_model = load_gdal_dataset(dataset)
        viz_tile_factory = GDALTileFactory(ds,
                                           sensor_model,
                                           GDALImageFormats.PNG,
                                           GDALCompressionOptions.NONE,
                                           output_type=gdalconst.GDT_Byte,
                                           range_adjustment=RangeAdjustmentType.DRA)
        tile_factory_cache[dataset] = viz_tile_factory
    return tile_factory_cache.get(dataset)
    
def get_image_tile(dataset, zoom, row, col):
    tile_factory = get_tile_factory(dataset)
    print(base64.b64encode(tile_factory.create_encoded_tile([int(col)*512, int(row)*512, 512, 512])).decode('utf-8'))

def create_recv(comm):
    def _recv(msg):
        # Use msg['content']['data'] for the data in the message
        # print(msg['content']['data'])
        dataset = msg['content']['data']['dataset']
        zoom = msg['content']['data']['zoom']
        row = msg['content']['data']['row']
        col = msg['content']['data']['col']
        tile_factory = get_tile_factory(dataset)
        if tile_factory is not None:
            comm.send({
                'type': "TILE_RESPONSE",
                'img': base64.b64encode(tile_factory.create_encoded_tile([int(col)*512, int(row)*512, 512, 512])).decode('utf-8')
            })
    return _recv    

def target_func(comm, msg):
    # comm is the kernel Comm instance
    # msg is the comm_open message

    # Register handler for later messages
    comm.on_msg(create_recv(comm))

    # Send data to the frontend
    comm.send({'type': "KERNEL_COMM_SETUP_COMPLETE"})

get_ipython().kernel.comm_manager.register_target('my_comm_target', target_func)
`;

/**
 * JupyterImageLayer: Allows rendering of image tiles from a Jupyter Kernel onto a Leaflet Map.
 */
export const JupyterImageLayer = GridLayer.extend({
  options: {
    tileSize: 512
  },
  /**
   * This initializes a custom Leaflet GridLayer that retrieves image tiles from a Python Kernel using the Jupyter
   * Messaging Protocol (see: https://jupyter-client.readthedocs.io/en/latest/messaging.html). On creation this layer
   * injects code into a Python Kernel that establishes the server side of a "comm" channel and sets up a
   * tile reader / cache based on the osml-imagery-toolkit. Then whenever a Leaflet Map invokes the createTile() function
   * on this layer a message is sent to the Jupyter kernel requesting the tile.
   *
   * Note that Leaflet has a custom approach to extending their base classes that does not make use of ECMAScript 2015
   * (ES6) classes. The approach used below is the one recommended in the Leaflet documentation here:
   * https://leafletjs.com/examples/extending/extending-1-classes.html
   *
   * @param sessionContext the session context needed to communicate with a remote Jupyter kernel
   * @param imageName the name/path of the image in relation to the local server
   * @param options configuration options for this layer
   */
  initialize: function (
    sessionContext: SessionContext,
    imageName: string,
    options: IJupyterImageLayerOptions
  ) {
    this.comm = undefined;
    this.sessionContext = sessionContext;
    this.imageName = imageName;
    setOptions(this, options);

    if (
      this.sessionContext.isReady &&
      this.sessionContext.session &&
      this.sessionContext.session.kernel
    ) {
      // Install the code on the Jupyter session needed to create tiles and setup the server side of the comm
      // channel.
      const setupFuture = this.sessionContext.session.kernel.requestExecute({
        code: KERNEL_SETUP_CODE
      });
      setupFuture.onIOPub = function (msg: any): void {
        //const msgType = msg.header.msg_type;
        //const content = msg.content;
        // TODO: How to handle errors in the initial code setup? Need to look for the successful setup message.
        console.log('Result of executing setup code in kernel!');
        console.log(msg);
      };

      // Create the client side of the comm channel.
      // TODO: Need to look at the possible race condition here. Consider moving this code inside the onIOPub handler
      //       to ensure it is only executed after the server side setup is complete.
      console.log('Setting up new comm!');
      this.comm =
        this.sessionContext.session.kernel.createComm('my_comm_target');
      this.comm.open('Open comm');
      console.log('Comm setup completed.');
    }
  },
  /**
   * This function creates a new div with an image to contain the image tile and then requests the tile from the
   * jupyter kernel across the comm channel. Note that the response from that channel will be handled asynchronusly
   * so the done() callback will be invoked after the image.src attribute has been updated with the content from the
   * kernel.
   *
   * @param coords the Leaflet tile coordinate
   * @param done the callback function to invoke when the resulting HTMLElement is ready to be rendered
   */
  createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const tile = document.createElement('div');
    const image = document.createElement('img');
    image.setAttribute('width', this.options.tileSize);
    image.setAttribute('height', this.options.tileSize);
    tile.appendChild(image);

    if (
      this.sessionContext.isReady &&
      this.sessionContext.session &&
      this.sessionContext.session.kernel
    ) {
      console.log('Fetching tile for coords: ' + coords);

      const commFuture = this.comm.send({
        dataset: this.imageName,
        zoom: coords.z,
        row: coords.y,
        col: coords.x
      });
      commFuture.onIOPub = function (msg: any): void {
        // TODO: Error handling? What happens if the tile can't be retrieved from the kernel.
        console.log('Received tile from comm!!!');
        //console.log(msg);
        // @ts-ignore
        image.src = 'data:image/png;base64, ' + msg.content.data.img;
        // This is necessary to let the layer know the tile has been fully loaded
        done(undefined, tile);
      };
    }
    return tile;
  }
});

/**
 * This is a factory function for constructing instances of JupyterImageLayer. This follows the extension design
 * patterns recommended by Leaflet.
 *
 * @param sessionContext the session context needed to communicate with a remote Jupyter kernel
 * @param imageName the name/path of the image in relation to the local server
 * @param options configuration options for this layer
 */
export function jupyterImageLayer(
  sessionContext: SessionContext,
  imageName: string,
  options: IJupyterImageLayerOptions
) {
  // @ts-ignore
  return new JupyterImageLayer(sessionContext, imageName, options);
}
