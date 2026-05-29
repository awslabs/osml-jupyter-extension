# Copyright Amazon.com, Inc. or its affiliates.

"""Kernel-side source of truth for live viewer state.

The frontend streams fire-and-forget ``VIEW_STATE_UPDATE`` / ``CLICK_EVENT``
messages into this store. The store keeps **raw image-space** state only and
does **no** sensor-model math on write — the image -> world transform is
expensive relative to event frequency and is computed lazily by the ``viewer``
object on read (see Design 4d / 4e).
"""


class ViewStateStore:
    """Single source of truth for live view state, in image-space.

    Attributes:
        current_image: dataset path of the image currently in view, or ``None``.
        view_bounds: last settled view rectangle as
            ``{minx, miny, maxx, maxy, zoom}`` in full-image pixel space, or
            ``None``.
        last_click: last click as ``{x, y, feature, layer_id}`` in image
            coordinates, or ``None``. ``feature``/``layer_id`` are populated
            only when a feature was hit.
    """

    def __init__(self):
        self.current_image = None
        self.view_bounds = None
        self.last_click = None

    def update_view(self, payload):
        """Store the settled view rectangle from a ``VIEW_STATE_UPDATE``.

        Raw image space only; performs no sensor-model math. Changing the
        current image clears any stale click so lazy ``.world`` reads on the
        ``viewer`` cannot resolve a click against the wrong sensor model.
        """
        image_name = payload.get('imageName')
        if image_name != self.current_image:
            self.current_image = image_name
            self.last_click = None

        self.view_bounds = {
            'minx': payload['minx'],
            'miny': payload['miny'],
            'maxx': payload['maxx'],
            'maxy': payload['maxy'],
            'zoom': payload['zoom'],
        }

    def update_click(self, payload):
        """Store a click from a ``CLICK_EVENT``.

        Raw image coordinates only; performs no sensor-model math.
        ``feature``/``layer_id`` are recorded only when the click hit a feature.
        """
        image_name = payload.get('imageName')
        if image_name != self.current_image:
            self.current_image = image_name

        click = {
            'x': payload['x'],
            'y': payload['y'],
            'feature': payload.get('feature'),
            'layer_id': payload.get('layerId'),
        }
        self.last_click = click
