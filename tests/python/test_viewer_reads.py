"""
Tests for the ``viewer`` object reads (Phase 6): lazy state reads with
memoized ``.world`` enrichment, toolkit passthroughs with clear ViewerError
guards, and metadata()/statistics()/features_in() queries.
"""

import math
from unittest.mock import MagicMock

import pytest

from aws.osml.jupyter.view_state import ViewStateStore
from aws.osml.jupyter.viewer import Click, Viewer, ViewBounds, ViewerError
from aws.osml.photogrammetry import GeodeticWorldCoordinate, ImageCoordinate


class RecordingSensorModel:
    """Sensor model that counts image_to_world calls and returns radians."""

    def __init__(self):
        self.calls = 0

    def image_to_world(self, image_coordinate, elevation_model=None, options=None):
        self.calls += 1
        # Return a deterministic radian coordinate derived from the pixel so we
        # can assert distinct corners without a real photogrammetry model.
        lon_rad = image_coordinate.x / 1000.0
        lat_rad = image_coordinate.y / 1000.0
        return GeodeticWorldCoordinate([lon_rad, lat_rad, 0.0])


def _session(sensor_model=None, metadata=None):
    session = MagicMock()
    session.sensor_model = sensor_model
    session.reader = MagicMock(name="reader")
    session.chip_factory = MagicMock(name="chip_factory")
    session.asset.metadata = metadata if metadata is not None else {}
    return session


def _make_viewer(current_image="img.tiff", session=None):
    """A viewer bound to a real ViewStateStore and a stubbed cache."""
    store = ViewStateStore()
    store.current_image = current_image
    cache = MagicMock()
    cache.get_image_session.return_value = session
    cache.overlay_indices = {}
    v = Viewer()
    v._bind(store, MagicMock(), cache)
    return v, store, cache


class TestInitializationGuards:
    def test_access_before_init_raises(self):
        v = Viewer()
        with pytest.raises(ViewerError, match="not initialized"):
            _ = v.current_image
        with pytest.raises(ViewerError, match="not initialized"):
            _ = v.view_bounds
        with pytest.raises(ViewerError, match="not initialized"):
            _ = v.reader


class TestCurrentImage:
    def test_reflects_store(self):
        v, store, _ = _make_viewer(current_image=None, session=None)
        assert v.current_image is None
        store.current_image = "a.tiff"
        assert v.current_image == "a.tiff"


class TestViewBounds:
    def test_none_when_no_bounds(self):
        v, _, _ = _make_viewer(session=_session())
        assert v.view_bounds is None

    def test_image_box_and_zoom(self):
        sm = RecordingSensorModel()
        v, store, _ = _make_viewer(session=_session(sensor_model=sm))
        store.view_bounds = {'minx': 0, 'miny': 0, 'maxx': 10, 'maxy': 20, 'zoom': 3}

        bounds = v.view_bounds
        assert isinstance(bounds, ViewBounds)
        assert bounds.zoom == 3
        assert bounds.image.bounds == (0.0, 0.0, 10.0, 20.0)

    def test_world_returns_four_corners_in_order(self):
        sm = RecordingSensorModel()
        v, store, _ = _make_viewer(session=_session(sensor_model=sm))
        store.view_bounds = {'minx': 0, 'miny': 0, 'maxx': 10, 'maxy': 20, 'zoom': 0}

        corners = v.view_bounds.world
        assert len(corners) == 4
        assert all(isinstance(c, GeodeticWorldCoordinate) for c in corners)
        # TL, TR, BR, BL image-corner order.
        xs = [round(c.longitude * 1000) for c in corners]
        ys = [round(c.latitude * 1000) for c in corners]
        assert xs == [0, 10, 10, 0]
        assert ys == [0, 0, 20, 20]

    def test_world_memoized_one_call_per_corner_set(self):
        sm = RecordingSensorModel()
        v, store, _ = _make_viewer(session=_session(sensor_model=sm))
        store.view_bounds = {'minx': 0, 'miny': 0, 'maxx': 10, 'maxy': 20, 'zoom': 0}

        _ = v.view_bounds.world
        _ = v.view_bounds.world
        # 4 corners projected once; the second read hits the memo.
        assert sm.calls == 4

    def test_world_polygon_is_closed_ring_in_degrees(self):
        sm = RecordingSensorModel()
        v, store, _ = _make_viewer(session=_session(sensor_model=sm))
        store.view_bounds = {'minx': 0, 'miny': 0, 'maxx': 1000, 'maxy': 1000, 'zoom': 0}

        poly = v.view_bounds.world_polygon
        assert poly['type'] == 'Polygon'
        ring = poly['coordinates'][0]
        assert len(ring) == 5  # 4 corners + closing point
        assert ring[0] == ring[-1]
        # 1000 px / 1000 = 1 rad -> degrees.
        assert ring[1][0] == pytest.approx(180.0 / math.pi)

    def test_new_settle_invalidates_world_memo(self):
        sm = RecordingSensorModel()
        v, store, _ = _make_viewer(session=_session(sensor_model=sm))
        store.view_bounds = {'minx': 0, 'miny': 0, 'maxx': 10, 'maxy': 20, 'zoom': 0}
        _ = v.view_bounds.world
        assert sm.calls == 4

        # A fresh settle replaces the raw dict; the wrapper must re-project.
        store.view_bounds = {'minx': 5, 'miny': 5, 'maxx': 15, 'maxy': 25, 'zoom': 1}
        _ = v.view_bounds.world
        assert sm.calls == 8


class TestLastClick:
    def test_none_when_no_click(self):
        v, _, _ = _make_viewer(session=_session())
        assert v.last_click is None

    def test_image_coordinate(self):
        sm = RecordingSensorModel()
        v, store, _ = _make_viewer(session=_session(sensor_model=sm))
        store.last_click = {'x': 3, 'y': 4, 'feature': None, 'layer_id': None}

        click = v.last_click
        assert isinstance(click, Click)
        assert isinstance(click.image, ImageCoordinate)
        assert (click.image.x, click.image.y) == (3.0, 4.0)

    def test_feature_and_layer(self):
        v, store, _ = _make_viewer(session=_session(sensor_model=RecordingSensorModel()))
        store.last_click = {'x': 1, 'y': 2, 'feature': {'id': 'f1'}, 'layer_id': 'lyr'}

        click = v.last_click
        assert click.feature == {'id': 'f1'}
        assert click.layer == 'lyr'

    def test_world_memoized_single_call(self):
        sm = RecordingSensorModel()
        v, store, _ = _make_viewer(session=_session(sensor_model=sm))
        store.last_click = {'x': 100, 'y': 200, 'feature': None, 'layer_id': None}

        w1 = v.last_click.world
        w2 = v.last_click.world
        assert isinstance(w1, GeodeticWorldCoordinate)
        assert w1 is w2
        assert sm.calls == 1

    def test_new_click_invalidates_world_memo(self):
        sm = RecordingSensorModel()
        v, store, _ = _make_viewer(session=_session(sensor_model=sm))
        store.last_click = {'x': 1, 'y': 1, 'feature': None, 'layer_id': None}
        _ = v.last_click.world
        assert sm.calls == 1

        store.last_click = {'x': 2, 'y': 2, 'feature': None, 'layer_id': None}
        _ = v.last_click.world
        assert sm.calls == 2


class TestToolkitPassthroughs:
    def test_reader(self):
        session = _session(sensor_model=RecordingSensorModel())
        v, _, _ = _make_viewer(session=session)
        assert v.reader is session.reader

    def test_chip_factory(self):
        session = _session(sensor_model=RecordingSensorModel())
        v, _, _ = _make_viewer(session=session)
        assert v.chip_factory is session.chip_factory

    def test_sensor_model(self):
        sm = RecordingSensorModel()
        v, _, _ = _make_viewer(session=_session(sensor_model=sm))
        assert v.sensor_model is sm

    def test_no_image_loaded_raises(self):
        # current_image set, but the cache has no session for it.
        v, _, _ = _make_viewer(session=None)
        with pytest.raises(ViewerError, match="No image loaded"):
            _ = v.reader

    def test_no_current_image_raises(self):
        v, store, _ = _make_viewer(current_image=None, session=None)
        with pytest.raises(ViewerError, match="No image loaded"):
            _ = v.chip_factory

    def test_no_sensor_model_raises(self):
        v, _, _ = _make_viewer(session=_session(sensor_model=None))
        with pytest.raises(ViewerError, match="no sensor model"):
            _ = v.sensor_model

    def test_world_read_without_sensor_model_raises(self):
        v, store, _ = _make_viewer(session=_session(sensor_model=None))
        store.last_click = {'x': 1, 'y': 2, 'feature': None, 'layer_id': None}
        with pytest.raises(ViewerError, match="no sensor model"):
            _ = v.last_click.world


class TestQueries:
    def test_metadata(self):
        session = _session(sensor_model=RecordingSensorModel(), metadata={'k': 'v'})
        v, _, _ = _make_viewer(session=session)
        assert v.metadata() == {'k': 'v'}

    def test_metadata_empty(self):
        session = _session(sensor_model=RecordingSensorModel(), metadata=None)
        v, _, _ = _make_viewer(session=session)
        assert v.metadata() == {}

    def test_features_in_defaults_to_current_view(self):
        session = _session(sensor_model=RecordingSensorModel())
        v, store, cache = _make_viewer(session=session)
        store.view_bounds = {'minx': 0, 'miny': 0, 'maxx': 10, 'maxy': 10, 'zoom': 0}

        index = MagicMock()
        index.find_intersects.return_value = [{'id': 'a'}]
        cache.overlay_indices = {'img.tiff:layer1': index}
        cache.get_overlay_index.return_value = index

        result = v.features_in()
        assert result == [{'id': 'a'}]
        # The passed geometry is the current view box.
        geom = index.find_intersects.call_args[0][0]
        assert geom.bounds == (0.0, 0.0, 10.0, 10.0)

    def test_features_in_explicit_bbox_tuple(self):
        session = _session(sensor_model=RecordingSensorModel())
        v, store, cache = _make_viewer(session=session)

        index = MagicMock()
        index.find_intersects.return_value = []
        cache.overlay_indices = {'img.tiff:layer1': index}
        cache.get_overlay_index.return_value = index

        v.features_in(bbox=(1, 2, 3, 4))
        geom = index.find_intersects.call_args[0][0]
        assert geom.bounds == (1.0, 2.0, 3.0, 4.0)

    def test_features_in_single_layer(self):
        session = _session(sensor_model=RecordingSensorModel())
        v, store, cache = _make_viewer(session=session)
        store.view_bounds = {'minx': 0, 'miny': 0, 'maxx': 10, 'maxy': 10, 'zoom': 0}

        idx1 = MagicMock()
        idx1.find_intersects.return_value = [{'id': '1'}]
        idx2 = MagicMock()
        idx2.find_intersects.return_value = [{'id': '2'}]
        cache.overlay_indices = {'img.tiff:a': idx1, 'img.tiff:b': idx2}
        cache.get_overlay_index.side_effect = lambda k: {
            'img.tiff:a': idx1, 'img.tiff:b': idx2
        }.get(k)

        result = v.features_in(layer='b')
        assert result == [{'id': '2'}]
        idx1.find_intersects.assert_not_called()

    def test_features_in_no_view_bounds_raises(self):
        session = _session(sensor_model=RecordingSensorModel())
        v, _, cache = _make_viewer(session=session)
        cache.overlay_indices = {}
        with pytest.raises(ViewerError, match="No view bounds"):
            v.features_in()
