"""
Tests for the ``viewer`` action verbs (Phase 8): ``add_layer`` / ``remove_layer``
index features and push render commands via ``CommRegistry.broadcast``, and
``goto`` / ``set_view`` build correct ``SET_VIEW`` push payloads (with lon/lat
converted to image space kernel-side).
"""

import math
from unittest.mock import MagicMock

import pytest

from aws.osml.jupyter.view_state import ViewStateStore
from aws.osml.jupyter.viewer import Viewer, ViewerError


class RecordingSensorModel:
    """Sensor model that records world_to_image calls and returns fixed pixels."""

    def __init__(self, x=42.0, y=84.0):
        self.calls = 0
        self._x = x
        self._y = y

    def world_to_image(self, world_coordinate):
        self.calls += 1
        self._last_world = world_coordinate
        return MagicMock(x=self._x, y=self._y)


def _session(sensor_model=None):
    session = MagicMock()
    session.sensor_model = sensor_model
    session.reader = MagicMock(name="reader")
    session.chip_factory = MagicMock(name="chip_factory")
    return session


def _make_viewer(current_image="img.tiff", session=None):
    """A viewer bound to a real ViewStateStore, a stubbed cache and comm registry."""
    store = ViewStateStore()
    store.current_image = current_image
    cache = MagicMock()
    cache.get_image_session.return_value = session
    comm_registry = MagicMock()
    comm_registry.broadcast.return_value = 1
    v = Viewer()
    v._bind(store, comm_registry, cache)
    return v, store, cache, comm_registry


class TestAddLayer:
    def test_indexes_features_and_pushes(self):
        v, _, cache, comm_registry = _make_viewer(session=_session())
        features = [{"type": "Feature"}]

        result = v.add_layer(features, "detections")

        assert result == "detections"
        cache.add_overlay_features.assert_called_once_with(
            "img.tiff", "detections", features
        )
        comm_registry.broadcast.assert_called_once_with(
            {"type": "ADD_LAYER", "name": "detections", "imageName": "img.tiff"}
        )

    def test_requires_name(self):
        v, _, cache, comm_registry = _make_viewer(session=_session())
        with pytest.raises(ViewerError, match="non-empty layer name"):
            v.add_layer([{"type": "Feature"}], "")
        cache.add_overlay_features.assert_not_called()
        comm_registry.broadcast.assert_not_called()

    def test_no_image_raises(self):
        v, _, _, comm_registry = _make_viewer(current_image=None, session=None)
        with pytest.raises(ViewerError, match="No image loaded"):
            v.add_layer([{"type": "Feature"}], "x")
        comm_registry.broadcast.assert_not_called()

    def test_index_failure_raises_and_no_push(self):
        v, _, cache, comm_registry = _make_viewer(session=_session())
        cache.add_overlay_features.side_effect = ValueError("bad geometry")
        with pytest.raises(ViewerError, match="Failed to add layer"):
            v.add_layer([{"type": "Feature"}], "x")
        comm_registry.broadcast.assert_not_called()

    def test_before_init_raises(self):
        v = Viewer()
        with pytest.raises(ViewerError, match="not initialized"):
            v.add_layer([], "x")

    def test_warns_when_index_is_empty(self, caplog):
        """A layer that indexes 0 features warns (silent blank-layer symptom)."""
        v, _, cache, comm_registry = _make_viewer(session=_session())
        # add_overlay_features returns the built index; simulate an empty one.
        empty_index = MagicMock()
        empty_index.features = []
        cache.add_overlay_features.return_value = empty_index

        with caplog.at_level("WARNING", logger="osml-jupyter-extension"):
            result = v.add_layer([{"type": "Feature"}], "detections")

        assert result == "detections"
        # Still pushes — the warning is advisory, not a failure.
        comm_registry.broadcast.assert_called_once()
        assert any(
            "indexed 0 features" in r.getMessage() and "detections" in r.getMessage()
            for r in caplog.records
        )

    def test_no_warning_when_features_indexed(self, caplog):
        """A non-empty index does not warn."""
        v, _, cache, comm_registry = _make_viewer(session=_session())
        index = MagicMock()
        index.features = [{"type": "Feature"}, {"type": "Feature"}]
        cache.add_overlay_features.return_value = index

        with caplog.at_level("WARNING", logger="osml-jupyter-extension"):
            v.add_layer([{"type": "Feature"}], "detections")

        assert not any("indexed 0 features" in r.getMessage() for r in caplog.records)

    def test_no_warning_when_count_unknown(self, caplog):
        """When the index feature count can't be determined, skip the warning.

        Uses an index whose ``features`` is not sizeable (``len()`` raises), so
        ``_index_feature_count`` returns ``None`` and add_layer must NOT warn
        rather than misreport an empty layer.
        """
        v, _, cache, comm_registry = _make_viewer(session=_session())

        class UnsizedIndex:
            features = object()  # a plain object() has no __len__

        cache.add_overlay_features.return_value = UnsizedIndex()

        with caplog.at_level("WARNING", logger="osml-jupyter-extension"):
            v.add_layer([{"type": "Feature"}], "detections")

        assert not any("indexed 0 features" in r.getMessage() for r in caplog.records)


class TestRemoveLayer:
    def test_unloads_index_and_pushes(self):
        v, _, cache, comm_registry = _make_viewer(session=_session())

        result = v.remove_layer("detections")

        assert result == "detections"
        cache.unload_overlay.assert_called_once_with("img.tiff", "detections")
        comm_registry.broadcast.assert_called_once_with(
            {"type": "REMOVE_LAYER", "name": "detections", "imageName": "img.tiff"}
        )

    def test_requires_name(self):
        v, _, _, comm_registry = _make_viewer(session=_session())
        with pytest.raises(ViewerError, match="non-empty layer name"):
            v.remove_layer(None)
        comm_registry.broadcast.assert_not_called()

    def test_no_image_raises(self):
        v, _, _, _ = _make_viewer(current_image=None, session=None)
        with pytest.raises(ViewerError, match="No image loaded"):
            v.remove_layer("x")


class TestGoto:
    def test_image_coords_push(self):
        v, _, _, comm_registry = _make_viewer(session=_session())

        v.goto(x=10, y=20, zoom=3)

        comm_registry.broadcast.assert_called_once_with(
            {"type": "SET_VIEW", "x": 10.0, "y": 20.0, "zoom": 3}
        )

    def test_image_coords_omits_zoom_when_none(self):
        v, _, _, comm_registry = _make_viewer(session=_session())

        v.goto(x=1, y=2)

        comm_registry.broadcast.assert_called_once_with(
            {"type": "SET_VIEW", "x": 1.0, "y": 2.0}
        )

    def test_lonlat_converts_kernel_side(self):
        sm = RecordingSensorModel(x=42.0, y=84.0)
        v, _, _, comm_registry = _make_viewer(session=_session(sensor_model=sm))

        v.goto(lon=45.0, lat=10.0, zoom=2)

        assert sm.calls == 1
        # Converted image pixels come from the sensor model.
        comm_registry.broadcast.assert_called_once_with(
            {"type": "SET_VIEW", "x": 42.0, "y": 84.0, "zoom": 2}
        )
        # The world coordinate handed to the sensor model is in radians.
        world = sm._last_world
        assert world.longitude == pytest.approx(45.0 * math.pi / 180.0)
        assert world.latitude == pytest.approx(10.0 * math.pi / 180.0)

    def test_lonlat_requires_both(self):
        v, _, _, _ = _make_viewer(session=_session(sensor_model=RecordingSensorModel()))
        with pytest.raises(ViewerError, match="both lon and lat"):
            v.goto(lon=45.0)

    def test_rejects_mixed_coordinates(self):
        v, _, _, _ = _make_viewer(session=_session(sensor_model=RecordingSensorModel()))
        with pytest.raises(ViewerError, match="either x/y or lon/lat, not both"):
            v.goto(x=1, y=2, lon=3.0, lat=4.0)

    def test_requires_some_coordinates(self):
        v, _, _, _ = _make_viewer(session=_session())
        with pytest.raises(ViewerError, match="requires either x/y or lon/lat"):
            v.goto()

    def test_lonlat_without_sensor_model_raises(self):
        v, _, _, _ = _make_viewer(session=_session(sensor_model=None))
        with pytest.raises(ViewerError, match="no sensor model"):
            v.goto(lon=1.0, lat=2.0)


class TestSetView:
    def test_tuple_bounds_center(self):
        v, _, _, comm_registry = _make_viewer(session=_session())

        v.set_view((0, 0, 10, 20), zoom=1)

        comm_registry.broadcast.assert_called_once_with(
            {"type": "SET_VIEW", "x": 5.0, "y": 10.0, "zoom": 1}
        )

    def test_shapely_bounds_center(self):
        import shapely

        v, _, _, comm_registry = _make_viewer(session=_session())

        v.set_view(shapely.box(2, 4, 6, 8))

        comm_registry.broadcast.assert_called_once_with(
            {"type": "SET_VIEW", "x": 4.0, "y": 6.0}
        )

    def test_before_init_raises(self):
        v = Viewer()
        with pytest.raises(ViewerError, match="not initialized"):
            v.set_view((0, 0, 1, 1))
