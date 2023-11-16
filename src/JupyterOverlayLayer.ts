import { Coords, DoneCallback, GridLayer, setOptions } from 'leaflet';
import { IJupyterImageLayerOptions } from './IJupyterImageLayerOptions';
import { Kernel } from '@jupyterlab/services';
import { Feature } from 'geojson';
import { FeatureRenderer } from './FeatureRenderer';

/**
 * JupyterOverlayLayer: Allows rendering of geojson features from a Jupyter Kernel onto an image in a  Leaflet Map.
 */
export const JupyterOverlayLayer = GridLayer.extend({
  options: {
    tileSize: 512
  },
  /**
   * This initializes a custom Leaflet GridLayer that retrieves feature tiles from a Python Kernel using the Jupyter
   * Messaging Protocol (see: https://jupyter-client.readthedocs.io/en/latest/messaging.html). On creation this layer
   * injects code into a Python Kernel that establishes the server side of a "comm" channel and sets up a
   * tile reader / cache based on the osml-imagery-toolkit. Then whenever a Leaflet Map invokes the createTile() function
   * on this layer a message is sent to the Jupyter kernel requesting the tile.
   *
   * Note that Leaflet has a custom approach to extending their base classes that does not make use of ECMAScript 2015
   * (ES6) classes. The approach used below is the one recommended in the Leaflet documentation here:
   * https://leafletjs.com/examples/extending/extending-1-classes.html
   *
   * @param comm the comm channel needed to communicate with a remote Jupyter kernel
   * @param imageName the name/path of the image in relation to the local server
   * @param overlayName the name/path of the overlay data in relation to the local server
   * @param options configuration options for this layer
   */
  initialize: function (
    comm: Kernel.IComm,
    imageName: string,
    overlayName: string,
    options: IJupyterImageLayerOptions
  ) {
    this.comm = comm;
    this.imageName = imageName;
    this.overlayName = overlayName;
    this.featureRenderer = new FeatureRenderer();
    setOptions(this, options);
  },
  /**
   * This function creates a new canvas to render the overlay tile and then requests the features from the
   * jupyter kernel across the comm channel. Note that the response from that channel will be handled asynchronusly
   * so the done() callback will be invoked after the rendering is complete.
   *
   * @param coords the Leaflet tile coordinate
   * @param done the callback function to invoke when the resulting HTMLElement is ready to be rendered
   */
  createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const tile = document.createElement('canvas');
    const tileSize = this.getTileSize();
    tile.setAttribute('width', tileSize.x);
    tile.setAttribute('height', tileSize.y);
    const tileIndex = [coords.x, coords.y];
    const tileOrigin: [number, number] = [
      tileIndex[0] * tileSize.x,
      tileIndex[1] * tileSize.y
    ];

    console.log('Fetching Overlay for coords: ' + coords);
    const featureRenderer: FeatureRenderer = this.featureRenderer;
    const commFuture = this.comm.send({
      type: 'OVERLAY_TILE_REQUEST',
      imageName: this.imageName,
      overlayName: this.overlayName,
      zoom: coords.z,
      row: coords.y,
      col: coords.x
    });
    commFuture.onIOPub = function (msg: any): void {
      const msgType = msg.header.msg_type;
      switch (msgType) {
        case 'comm_msg':
          console.log(
            'Received overlay tile from comm containing ' +
              msg.content?.data?.features?.length +
              ' features.'
          );
          setTimeout(() => {
            const ctx = tile.getContext('2d');
            console.log('Drawing annotation tile: ' + tileIndex);
            msg.content.data.features.forEach((feature: Feature) => {
              featureRenderer.drawFeature(ctx, feature, tileOrigin);
            });
            // This is necessary to let the layer know the tile has been fully loaded
            done(undefined, tile);
          }, 10);
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
 * @param overlayName the name/path of the overlay in relation to the local sesrver
 * @param options configuration options for this layer
 */
export function jupyterOverlayLayer(
  comm: Kernel.IComm | undefined,
  imageName: string,
  overlayName: string,
  options: IJupyterImageLayerOptions
) {
  // @ts-ignore: Leaflet custom extends() approach does not play well with typescript
  return new JupyterOverlayLayer(comm, imageName, overlayName, options);
}
