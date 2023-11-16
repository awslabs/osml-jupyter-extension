import { Coords, DoneCallback, GridLayer, setOptions } from 'leaflet';
import { IJupyterImageLayerOptions } from './IJupyterImageLayerOptions';
import { Kernel } from '@jupyterlab/services';

/**
 * JupyterImageLayer: Allows rendering of image tiles from a Jupyter Kernel onto a Leaflet Map.
 */
export const JupyterImageLayer = GridLayer.extend({
  options: {
    tileSize: 512
  },
  /**
   * This initializes a custom Leaflet GridLayer that retrieves image tiles from a Python Kernel using the Jupyter
   * Messaging Protocol (see: https://jupyter-client.readthedocs.io/en/latest/messaging.html).
   *
   * Note that Leaflet has a custom approach to extending their base classes that does not make use of ECMAScript 2015
   * (ES6) classes. The approach used below is the one recommended in the Leaflet documentation here:
   * https://leafletjs.com/examples/extending/extending-1-classes.html
   *
   * @param comm the comm channel needed to communicate with a remote Jupyter kernel
   * @param imageName the name/path of the image in relation to the local server
   * @param options configuration options for this layer
   */
  initialize: function (
    comm: Kernel.IComm,
    imageName: string,
    options: IJupyterImageLayerOptions
  ) {
    this.comm = comm;
    this.imageName = imageName;
    setOptions(this, options);
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

    console.log('Fetching tile for coords: ' + coords);

    const commFuture = this.comm.send({
      type: 'IMAGE_TILE_REQUEST',
      dataset: this.imageName,
      zoom: coords.z,
      row: coords.y,
      col: coords.x
    });
    commFuture.onIOPub = function (msg: any): void {
      const msgType = msg.header.msg_type;
      switch (msgType) {
        case 'comm_msg':
          console.log('Received image tile from comm!!!');
          //console.log(msg);
          image.src = 'data:image/png;base64, ' + msg.content.data.img;
          // This is necessary to let the layer know the tile has been fully loaded
          done(undefined, tile);
          // TODO: Error handling? What happens if the tile can't be retrieved from the kernel.
          break;
      }
    };

    return tile;
  }
});

/**
 * This is a factory function for constructing instances of JupyterImageLayer. This follows the extension design
 * patterns recommended by Leaflet.
 *
 * @param comm the comm channel needed to communicate with a remote Jupyter kernel
 * @param imageName the name/path of the image in relation to the local server
 * @param options configuration options for this layer
 */
export function jupyterImageLayer(
  comm: Kernel.IComm,
  imageName: string,
  options: IJupyterImageLayerOptions
) {
  // @ts-ignore: Leaflet custom extends() approach does not play well with typescript
  return new JupyterImageLayer(comm, imageName, options);
}
