# Copyright Amazon.com, Inc. or its affiliates.

"""Programmatic ``viewer`` object exposed at ``aws.osml.jupyter``.

The ``viewer`` singleton lets an attached notebook read the live view state
(current image, settled view bounds, last click + clicked feature), reach the
underlying toolkit objects for the current image (``reader`` / ``sensor_model`` /
``chip_factory``), and query imagery (metadata, statistics, features).

It **lazily binds** to the ``ViewStateStore``, ``CommRegistry``, and cache that
``initialize()`` populates (see Design 4f). The kernel-side ``ViewStateStore``
holds **raw image-space** state only; the expensive image -> world transform is
computed **lazily, on read**, and memoized per click / per bounds (Design 4e).

Action verbs (``add_layer`` / ``remove_layer`` / ``goto`` / ``set_view``) index
features and push render commands to the frontend via ``CommRegistry.broadcast``
(see Design 4f / 4g).
"""

import logging
import math

import shapely

_RAD_TO_DEG = 180.0 / math.pi
_DEG_TO_RAD = math.pi / 180.0

logger = logging.getLogger('osml-jupyter-extension')


def _index_feature_count(index):
    """Best-effort feature count for a freshly built overlay index.

    ``add_overlay_features`` returns the ``STRFeature2DSpatialIndex`` it built,
    whose ``.features`` is the list of features that survived projection. Returns
    the count, or ``None`` when it cannot be determined (e.g. a stubbed index in
    tests) so callers can skip the empty-layer warning rather than guess.
    """
    features = getattr(index, 'features', None)
    try:
        return len(features)
    except TypeError:
        return None


class ViewerError(RuntimeError):
    """Raised for viewer misuse — not initialized, no image, no sensor model."""


def _image_to_world(sensor_model, x, y):
    """Transform an image pixel to a ``GeodeticWorldCoordinate`` (radians)."""
    from aws.osml.photogrammetry import ImageCoordinate

    return sensor_model.image_to_world(ImageCoordinate([float(x), float(y)]))


def _to_lonlat_degrees(world_coord):
    """Return ``[longitude_deg, latitude_deg]`` for a ``GeodeticWorldCoordinate``.

    ``GeodeticWorldCoordinate`` stores radians; GeoJSON wants degrees.
    """
    return [world_coord.longitude * _RAD_TO_DEG, world_coord.latitude * _RAD_TO_DEG]


class ViewBounds:
    """Settled view rectangle in full-image pixel space, with lazy ``.world``.

    ``.image`` is a shapely box in image pixels; ``.zoom`` is the view zoom.
    ``.world`` lazily projects the four image corners to
    ``GeodeticWorldCoordinate`` in image-corner order (TL, TR, BR, BL) — a
    general (possibly rotated/skewed) quadrilateral, **not** a lat/lon bbox.
    ``.world_polygon`` wraps those same corners as a GeoJSON ``Polygon``.
    """

    def __init__(self, raw, viewer):
        self._raw = raw
        self._viewer = viewer
        self._world_corners = None

    @property
    def image(self):
        return shapely.box(
            self._raw['minx'], self._raw['miny'], self._raw['maxx'], self._raw['maxy']
        )

    @property
    def zoom(self):
        return self._raw['zoom']

    @property
    def world(self):
        """Four corner ``GeodeticWorldCoordinate``s (TL, TR, BR, BL); memoized."""
        if self._world_corners is None:
            sensor_model = self._viewer.sensor_model
            minx, miny = self._raw['minx'], self._raw['miny']
            maxx, maxy = self._raw['maxx'], self._raw['maxy']
            # Image-corner order: top-left, top-right, bottom-right, bottom-left.
            corners = [
                (minx, miny),
                (maxx, miny),
                (maxx, maxy),
                (minx, maxy),
            ]
            self._world_corners = [
                _image_to_world(sensor_model, x, y) for x, y in corners
            ]
        return self._world_corners

    @property
    def world_polygon(self):
        """The four ``.world`` corners as a closed GeoJSON ``Polygon`` (degrees)."""
        ring = [_to_lonlat_degrees(c) for c in self.world]
        ring.append(ring[0])
        return {'type': 'Polygon', 'coordinates': [ring]}


class Click:
    """Last click in image space, with lazy ``.world``.

    ``.image`` is an ``ImageCoordinate``; ``.world`` lazily projects it to a
    ``GeodeticWorldCoordinate`` (memoized). ``.feature`` / ``.layer`` are
    populated only when the click hit a feature.
    """

    def __init__(self, raw, viewer):
        self._raw = raw
        self._viewer = viewer
        self._world = None

    @property
    def image(self):
        from aws.osml.photogrammetry import ImageCoordinate

        return ImageCoordinate([float(self._raw['x']), float(self._raw['y'])])

    @property
    def world(self):
        """The click as a ``GeodeticWorldCoordinate``; memoized."""
        if self._world is None:
            sensor_model = self._viewer.sensor_model
            self._world = _image_to_world(sensor_model, self._raw['x'], self._raw['y'])
        return self._world

    @property
    def feature(self):
        return self._raw.get('feature')

    @property
    def layer(self):
        return self._raw.get('layer_id')


class Viewer:
    """Module-level singleton bound to the live kernel state by ``initialize()``."""

    def __init__(self):
        self._store = None
        self._comm_registry = None
        self._cache = None
        # Wrapper memos, keyed by the identity of the underlying raw state so a
        # new settle / click transparently invalidates the lazy .world memo.
        self._bounds_raw = None
        self._bounds_wrapper = None
        self._click_raw = None
        self._click_wrapper = None
        self._stats_proc = None

    def _bind(self, store, comm_registry, cache):
        """Bind to the live store/registry/cache (called by ``initialize()``)."""
        self._store = store
        self._comm_registry = comm_registry
        self._cache = cache
        self._bounds_raw = None
        self._bounds_wrapper = None
        self._click_raw = None
        self._click_wrapper = None
        self._stats_proc = None

    def _require_init(self):
        if self._store is None:
            raise ViewerError("Viewer not initialized — open an image first")

    def _current_session(self):
        self._require_init()
        image = self._store.current_image
        if image is None:
            raise ViewerError("No image loaded")
        session = self._cache.get_image_session(image)
        if session is None:
            raise ViewerError("No image loaded")
        return session

    # ── Readable state ──────────────────────────────────────────────────────

    @property
    def current_image(self):
        self._require_init()
        return self._store.current_image

    @property
    def view_bounds(self):
        self._require_init()
        raw = self._store.view_bounds
        if raw is None:
            return None
        if self._bounds_wrapper is None or self._bounds_raw is not raw:
            self._bounds_raw = raw
            self._bounds_wrapper = ViewBounds(raw, self)
        return self._bounds_wrapper

    @property
    def last_click(self):
        self._require_init()
        raw = self._store.last_click
        if raw is None:
            return None
        if self._click_wrapper is None or self._click_raw is not raw:
            self._click_raw = raw
            self._click_wrapper = Click(raw, self)
        return self._click_wrapper

    # ── Direct toolkit objects for the current image ──────────────────────────

    @property
    def reader(self):
        return self._current_session().reader

    @property
    def sensor_model(self):
        session = self._current_session()
        if session.sensor_model is None:
            raise ViewerError("Image has no sensor model")
        return session.sensor_model

    @property
    def chip_factory(self):
        return self._current_session().chip_factory

    # ── Query ─────────────────────────────────────────────────────────────────

    def metadata(self):
        """Metadata for the current image."""
        session = self._current_session()
        return dict(session.asset.metadata) if session.asset.metadata else {}

    def statistics(self, compute_histogram=False, histogram_bins=256):
        """Statistics for the current image (reuses the processor extraction)."""
        session = self._current_session()
        return self._statistics_processor()._extract_statistics(
            session, compute_histogram, histogram_bins
        )

    def features_in(self, bbox=None, layer=None):
        """Features intersecting ``bbox`` (defaults to the current view).

        ``bbox`` may be a shapely geometry or an ``(minx, miny, maxx, maxy)``
        tuple in image pixel space. ``layer`` restricts the search to a single
        named overlay; otherwise every overlay loaded for the current image is
        searched. Returns a flat list of GeoJSON features.
        """
        self._require_init()
        image = self._store.current_image
        if image is None:
            raise ViewerError("No image loaded")

        geometry = self._resolve_bbox(bbox)

        if layer is not None:
            keys = [f"{image}:{layer}"]
        else:
            prefix = f"{image}:"
            keys = [k for k in self._cache.overlay_indices if k.startswith(prefix)]

        results = []
        for key in keys:
            index = self._cache.get_overlay_index(key)
            if index is None:
                continue
            found = index.find_intersects(geometry)
            if found:
                results.extend(found)
        return results

    def _resolve_bbox(self, bbox):
        if bbox is None:
            raw = self._store.view_bounds
            if raw is None:
                raise ViewerError("No view bounds available — navigate the viewer first")
            return shapely.box(raw['minx'], raw['miny'], raw['maxx'], raw['maxy'])
        if hasattr(bbox, 'bounds'):
            return bbox
        minx, miny, maxx, maxy = bbox
        return shapely.box(minx, miny, maxx, maxy)

    def _statistics_processor(self):
        if self._stats_proc is None:
            from aws.osml.jupyter.core import OSMLKernelLogger
            from aws.osml.jupyter.processors.image import ImageStatisticsProcessor

            self._stats_proc = ImageStatisticsProcessor(self._cache, OSMLKernelLogger())
        return self._stats_proc

    # ── Actions (push to frontend) ────────────────────────────────────────────

    def add_layer(self, features, name):
        """Project + index ``features`` and push an ``ADD_LAYER`` render command.

        ``features`` may be a GeoJSON ``FeatureCollection`` dict, a
        ``list[Feature]``, or any object exposing ``__geo_interface__`` (a
        GeoDataFrame is duck-typed — no hard geopandas dependency). ``name`` is
        required; re-adding under the same name replaces the existing layer so
        re-running a cell is idempotent.

        The features are indexed under ``image_name:name`` on the kernel; the
        ``ADD_LAYER`` push carries only the layer name, and the frontend streams
        the features back over the existing ``OVERLAY_TILE_REQUEST`` tile path.
        """
        if not name:
            raise ViewerError("add_layer requires a non-empty layer name")

        image = self._require_current_image()
        try:
            index = self._cache.add_overlay_features(image, name, features)
        except Exception as e:
            raise ViewerError(f"Failed to add layer '{name}': {e}")

        # A layer that indexed zero features still registers and pushes, so it
        # appears in the layer list but renders nothing. That silent blank layer
        # almost always means the features carried no usable image geometry
        # (e.g. neither ``imageGeometry``/``imageBBox`` nor a geographic
        # ``geometry`` the sensor model could project). Warn so it is diagnosable
        # instead of looking like a rendering failure.
        indexed = _index_feature_count(index)
        if indexed == 0:
            logger.warning(
                "add_layer('%s') indexed 0 features — the layer will render "
                "nothing. Check that each feature has an 'imageBBox'/'imageGeometry' "
                "(image pixel space) or a geographic 'geometry' the sensor model "
                "can project.",
                name,
            )

        self._push({'type': 'ADD_LAYER', 'name': name, 'imageName': image})
        return name

    def remove_layer(self, name):
        """Unload the layer index and push a ``REMOVE_LAYER`` render command."""
        if not name:
            raise ViewerError("remove_layer requires a non-empty layer name")

        image = self._require_current_image()
        self._cache.unload_overlay(image, name)
        self._push({'type': 'REMOVE_LAYER', 'name': name, 'imageName': image})
        return name

    def goto(self, x=None, y=None, lon=None, lat=None, zoom=None):
        """Move the viewport to a point, pushing ``SET_VIEW``.

        Accepts either image-space ``x``/``y`` or geographic ``lon``/``lat``
        (degrees). Geographic coordinates are converted to image space
        kernel-side via the current sensor model. ``zoom`` is optional; when
        omitted the frontend preserves the current zoom.
        """
        if lon is not None or lat is not None:
            if lon is None or lat is None:
                raise ViewerError("goto requires both lon and lat when using geographic coordinates")
            if x is not None or y is not None:
                raise ViewerError("goto accepts either x/y or lon/lat, not both")
            x, y = self._world_to_image(lon, lat)
        elif x is None or y is None:
            raise ViewerError("goto requires either x/y or lon/lat coordinates")

        message = {'type': 'SET_VIEW', 'x': float(x), 'y': float(y)}
        if zoom is not None:
            message['zoom'] = zoom
        self._push(message)

    def set_view(self, bounds, zoom=None):
        """Move the viewport to the center of ``bounds``, pushing ``SET_VIEW``.

        ``bounds`` is an image-space rectangle: a shapely geometry (its
        ``.bounds`` are used) or an ``(minx, miny, maxx, maxy)`` tuple. The
        push carries the rectangle center; ``zoom`` is optional.
        """
        self._require_init()
        if hasattr(bounds, 'bounds'):
            minx, miny, maxx, maxy = bounds.bounds
        else:
            minx, miny, maxx, maxy = bounds

        message = {
            'type': 'SET_VIEW',
            'x': (float(minx) + float(maxx)) / 2.0,
            'y': (float(miny) + float(maxy)) / 2.0,
        }
        if zoom is not None:
            message['zoom'] = zoom
        self._push(message)

    def _require_current_image(self):
        self._require_init()
        image = self._store.current_image
        if image is None:
            raise ViewerError("No image loaded")
        return image

    def _world_to_image(self, lon, lat):
        """Convert lon/lat degrees to image pixels via the current sensor model."""
        from aws.osml.photogrammetry import GeodeticWorldCoordinate

        sensor_model = self.sensor_model
        world = GeodeticWorldCoordinate([lon * _DEG_TO_RAD, lat * _DEG_TO_RAD, 0.0])
        image_coord = sensor_model.world_to_image(world)
        return image_coord.x, image_coord.y

    def _push(self, message):
        """Broadcast a push message to all live comms."""
        self._require_init()
        if self._comm_registry is None:
            raise ViewerError("Viewer not initialized — open an image first")
        return self._comm_registry.broadcast(message)


viewer = Viewer()
