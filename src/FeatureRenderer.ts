import type { Feature } from 'geojson';

/**
 * A class capable of drawing GeoJSON Features on a HTML Canvas.
 */
export class FeatureRenderer {
  private IMAGE_GEOMETRY_PROPERTY = 'imageGeometry';

  /**
   * This is the public interface for drawing GeoJSON features on a HTML Canvas.
   *
   * Note that this basic implementation only renders the "imageGeometry" property
   * and ignores all other feature properties. It will be extended over time to
   * make a more interesting representation of the feature. The function only
   * supports Point, LineString, and Polygon geometries at this time.
   *
   * @param ctx the 2D drawing context from a HTML Canvas
   * @param feature the GeoJSON feature
   * @param tileOrigin the upper left origin of the canvas
   */
  public drawFeature(
    ctx: CanvasRenderingContext2D | null,
    feature: Feature,
    tileOrigin: readonly [number, number]
  ) {
    console.log('drawFeature', feature, tileOrigin);
    // eslint-disable-next-line no-prototype-builtins
    if (feature.properties?.hasOwnProperty(this.IMAGE_GEOMETRY_PROPERTY)) {
      const geometryType =
        feature.properties[this.IMAGE_GEOMETRY_PROPERTY]['type'];
      if (geometryType === 'Point') {
        this.drawPoint(
          ctx,
          feature.properties[this.IMAGE_GEOMETRY_PROPERTY]['coordinates'],
          tileOrigin
        );
      } else if (geometryType === 'LineString') {
        this.drawLineString(
          ctx,
          feature.properties[this.IMAGE_GEOMETRY_PROPERTY]['coordinates'],
          tileOrigin
        );
      } else if (geometryType === 'Polygon') {
        this.drawPolygon(
          ctx,
          feature.properties[this.IMAGE_GEOMETRY_PROPERTY]['coordinates'],
          tileOrigin
        );
      } else {
        console.log('Attempted to draw unknown geometry type: ' + geometryType);
      }
    }
  }

  /**
   * Function to draw a point geometry on a canvas.
   *
   * @param ctx the 2D drawing context from a HTML Canvas
   * @param coordinates the coordinates for this geometry
   * @param tileOrigin the upper left origin of the canvas
   * @private
   */
  private drawPoint(
    ctx: CanvasRenderingContext2D | null,
    coordinates: readonly [number, number],
    tileOrigin: readonly [number, number]
  ) {
    console.log('drawPoint', coordinates, tileOrigin);
    if (ctx) {
      ctx.beginPath();
      ctx.arc(
        coordinates[0] - tileOrigin[0],
        coordinates[1] - tileOrigin[1],
        20,
        0,
        2 * Math.PI,
        false
      );
      ctx.fillStyle = '#FF00002F';
      ctx.strokeStyle = '#FF0000FF';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * Function to draw a polygon geometry on a canvas. Note that this
   * implementation currently only draws the outside shell of the polygon and
   * ignores any holes.
   *
   * @param ctx the 2D drawing context from a HTML Canvas
   * @param coordinates the coordinates for this geometry
   * @param tileOrigin the upper left origin of the canvas
   * @private
   */
  private drawPolygon(
    ctx: CanvasRenderingContext2D | null,
    coordinates: Array<Array<Array<number>>>,
    tileOrigin: readonly [number, number]
  ) {
    console.log('drawPolygon', coordinates, tileOrigin);
    if (ctx) {
      const shell = coordinates[0];
      //ctx.strokeStyle = 'rgba(1.0,0.0,0.0,1.0)';
      ctx.beginPath();
      ctx.moveTo(shell[0][0] - tileOrigin[0], shell[0][1] - tileOrigin[1]);
      for (let i = 1; i < shell.length; i++) {
        ctx.lineTo(shell[i][0] - tileOrigin[0], shell[i][1] - tileOrigin[1]);
      }
      ctx.closePath();

      ctx.strokeStyle = '#FF0000FF';
      ctx.fillStyle = '#FF00002F';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * Function to draw a line geometry on a canvas.
   *
   * @param ctx the 2D drawing context from a HTML Canvas
   * @param coordinates the coordinates for this geometry
   * @param tileOrigin the upper left origin of the canvas
   * @private
   */
  private drawLineString(
    ctx: CanvasRenderingContext2D | null,
    coordinates: Array<Array<number>>,
    tileOrigin: readonly [number, number]
  ) {
    console.log('drawLineString', coordinates, tileOrigin);
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(
        coordinates[0][0] - tileOrigin[0],
        coordinates[0][1] - tileOrigin[1]
      );
      for (let i = 1; i < coordinates.length; i++) {
        ctx.lineTo(
          coordinates[i][0] - tileOrigin[0],
          coordinates[i][1] - tileOrigin[1]
        );
      }
      ctx.strokeStyle = '#FF0000FF';
      ctx.fillStyle = '#FF00002F';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
