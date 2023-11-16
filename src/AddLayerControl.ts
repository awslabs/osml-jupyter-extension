import {
  Control,
  Map,
  DomUtil,
  DomEvent,
  setOptions,
  ControlOptions
} from 'leaflet';

/**
 * AddLayerControl: A Leaflet control that when clicked will invoke a callback that adds a layer to the map.
 */
export const AddLayerControl = Control.extend({
  options: {},
  /**
   * This initializes the control with a callback that will be invoked when the control button is pressed. All
   * the logic for completing the task should be in the callback.
   *
   * @param callback the action to take when this control is activated
   * @param options leaflet Control options
   */
  initialize: function (callback: any, options: ControlOptions) {
    // @ts-ignore: Leaflet extend makes it hard for TS to find class members
    this.callbackFn = callback;
    setOptions(this, options);
  },

  /**
   * The onAdd function must return the top-most HTML element for this control.
   *
   * @param map map the control will overlay on. (Not used by this implementation but required to match signature)
   */
  onAdd: function (map: Map) {
    const div = DomUtil.create('div', 'leaflet-control-layers leaflet-control');
    const link = DomUtil.create('a', 'leaflet-control-layers-toggle');
    link.href = '#';
    link.title = 'AddLayer';
    link.role = 'button';
    link.innerText = '+';
    div.appendChild(link);
    DomEvent.disableClickPropagation(div);
    DomEvent.on(link, 'click', DomEvent.stop);
    // @ts-ignore: Leaflet extend makes it hard for TS to find class members
    DomEvent.on(link, 'click', this.callbackFn, this);
    return div;
  },

  onRemove: function (map: Map) {
    // Nothing to do here
  }
});

/**
 * This is a factory function for constructing instances of AddLayerControl. This follows the extension design
 * patterns recommended by Leaflet.
 *
 * @param callback the action to take when this control is activated
 * @param options leaflet Control options
 */
export function addLayerControl(callback: any, options: ControlOptions) {
  // @ts-ignore: Leaflet custom extends() approach does not play well with typescript
  return new AddLayerControl(callback, options);
}
