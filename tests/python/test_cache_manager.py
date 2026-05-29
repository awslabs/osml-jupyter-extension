"""
Unit tests for AdvancedCacheManager
"""

import json
import sys
import time
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

OSML_KERNEL_CACHE_PATH = (
    Path(__file__).parent.parent.parent / "src" / "kernel" / "aws" / "osml" / "jupyter" / "cache.py"
)


class MockAsset:
    """Mock ImageAssetProvider"""

    def __init__(self, width=512, height=512, num_bands=3):
        self.num_columns = width
        self.num_rows = height
        self.num_bands = num_bands
        self.metadata = {}
        self.pixel_value_type = "UInt8"
        self.block_grid_size = (1, 1)


class MockReader:
    """Mock DatasetReader"""

    def __init__(self, asset=None):
        self._asset = asset or MockAsset()
        self._closed = False

    def get_asset(self, key):
        if key == "image:0":
            return self._asset
        raise KeyError(key)

    def get_asset_keys(self):
        return ["image:0"]

    def close(self):
        self._closed = True


class MockPyramid:
    """Mock TiledImagePyramid"""

    def __init__(self, num_levels=3):
        self._num_levels = num_levels
        self.scale_factor = 2

    @property
    def num_levels(self):
        return self._num_levels

    def compute_statistics(self, **kwargs):
        return MagicMock()


class MockChipFactory:
    """Mock ChipFactory"""

    def create_chip(self, src_window, output_size=None):
        return bytearray(b'\x89PNG\r\n\x1a\n' + b'\x00' * 100)


class MockProcessingChain:
    """Mock ProcessingChain"""

    def __init__(self):
        self.input_bands = None
        self.output_bands = 3

    def __call__(self, image):
        return image


class MockSensorModel:
    """Mock SensorModel"""

    def world_to_image(self, world_coord):
        return MagicMock(x=100.0, y=200.0)

    def image_to_world(self, image_coord):
        return MagicMock(latitude=0.5, longitude=0.5, elevation=0.0)


def _build_mock_modules(
    io_open_return=None,
    load_sensor_model_return=None,
    pyramid_from_dataset_return=None,
    pyramid_from_providers_return=None,
    build_levels_return=None,
    display_chain_build_return=None,
    chip_factory_return=None,
    projector_return=None,
    index_return=None,
    is_complex_return=False,
    load_complex_remap_return=None,
):
    """Build mock modules for aws.osml.jupyter.cache's aws.osml.* dependencies."""
    # aws.osml.io
    mock_io_mod = ModuleType("aws.osml.io")
    mock_io_cls = MagicMock()
    mock_io_cls.open.return_value = io_open_return or MockReader()
    mock_io_mod.IO = mock_io_cls

    # aws.osml.metadata
    mock_metadata_mod = ModuleType("aws.osml.metadata")
    mock_load_sm = MagicMock(return_value=load_sensor_model_return)
    mock_metadata_mod.load_sensor_model = mock_load_sm

    # aws.osml.image_processing
    mock_ip_mod = ModuleType("aws.osml.image_processing")

    mock_pyramid_cls = MagicMock()
    mock_pyramid_cls.from_dataset.return_value = pyramid_from_dataset_return or MockPyramid(num_levels=3)
    mock_pyramid_cls.from_providers.return_value = pyramid_from_providers_return or MockPyramid(num_levels=3)
    mock_ip_mod.TiledImagePyramid = mock_pyramid_cls

    mock_build_levels = MagicMock(return_value=build_levels_return or [MockAsset()])
    mock_ip_mod.build_pyramid_levels = mock_build_levels

    mock_display_cls = MagicMock()
    mock_display_cls.build.return_value = display_chain_build_return or MockProcessingChain()
    mock_ip_mod.DisplayChainFactory = mock_display_cls

    mock_chip_cls = MagicMock(return_value=chip_factory_return or MockChipFactory())
    mock_ip_mod.ChipFactory = mock_chip_cls

    mock_mapped_provider_cls = MagicMock()
    mock_ip_mod.MappedImageProvider = mock_mapped_provider_cls

    mock_sampling_strategy = MagicMock()
    mock_sampling_strategy.BLOCK = "block"
    mock_sampling_strategy.ALL = "all"
    mock_ip_mod.SamplingStrategy = mock_sampling_strategy

    mock_is_complex = MagicMock(return_value=is_complex_return)
    mock_ip_mod.is_complex = mock_is_complex

    mock_load_complex_remap = MagicMock(return_value=load_complex_remap_return)
    mock_ip_mod.load_complex_remap = mock_load_complex_remap

    mock_ip_stats_mod = ModuleType("aws.osml.image_processing.statistics")
    mock_compute_stats = MagicMock(return_value=MagicMock())
    mock_ip_stats_mod.compute_image_statistics = mock_compute_stats

    mock_ip_tile_cache_mod = ModuleType("aws.osml.image_processing.tile_cache")
    mock_tile_cache_cls = MagicMock()
    mock_tile_cache_instance = MagicMock()
    mock_tile_cache_instance.current_bytes = 0
    mock_tile_cache_instance.max_bytes = 5 * 1024**3
    mock_tile_cache_cls.return_value = mock_tile_cache_instance
    mock_ip_tile_cache_mod.TileCache = mock_tile_cache_cls
    mock_ip_mod.tile_cache = mock_ip_tile_cache_mod

    # aws.osml.features
    mock_features_mod = ModuleType("aws.osml.features")

    mock_index_cls = MagicMock(return_value=index_return or MagicMock())
    mock_features_mod.STRFeature2DSpatialIndex = mock_index_cls

    mock_accessor_cls = MagicMock()
    mock_features_mod.ImagedFeaturePropertyAccessor = mock_accessor_cls

    mock_projector_cls = MagicMock()
    if projector_return is not None:
        mock_projector_cls.return_value = projector_return
    else:
        proj_instance = MagicMock()
        proj_instance.project_features.return_value = []
        mock_projector_cls.return_value = proj_instance
    mock_features_mod.Projector = mock_projector_cls

    mock_aws = ModuleType("aws")
    mock_aws_osml = ModuleType("aws.osml")
    mock_aws.osml = mock_aws_osml

    modules = {
        "aws": mock_aws,
        "aws.osml": mock_aws_osml,
        "aws.osml.io": mock_io_mod,
        "aws.osml.metadata": mock_metadata_mod,
        "aws.osml.image_processing": mock_ip_mod,
        "aws.osml.image_processing.statistics": mock_ip_stats_mod,
        "aws.osml.image_processing.tile_cache": mock_ip_tile_cache_mod,
        "aws.osml.features": mock_features_mod,
    }

    mocks = {
        "io_cls": mock_io_cls,
        "load_sensor_model": mock_load_sm,
        "pyramid_cls": mock_pyramid_cls,
        "build_levels": mock_build_levels,
        "display_cls": mock_display_cls,
        "chip_cls": mock_chip_cls,
        "mapped_provider_cls": mock_mapped_provider_cls,
        "is_complex": mock_is_complex,
        "load_complex_remap": mock_load_complex_remap,
        "compute_stats": mock_compute_stats,
        "index_cls": mock_index_cls,
        "projector_cls": mock_projector_cls,
        "accessor_cls": mock_accessor_cls,
        "tile_cache_cls": mock_tile_cache_cls,
    }

    return modules, mocks


def _patch_cache_module(mock_modules):
    """Context manager: patch sys.modules with mock_modules and reload aws.osml.jupyter.cache."""
    import importlib
    import aws.osml.jupyter.cache as cache_mod

    saved = {}
    for name, mod in mock_modules.items():
        if name in sys.modules:
            saved[name] = sys.modules[name]
        sys.modules[name] = mod

    importlib.reload(cache_mod)

    return cache_mod, saved


def _restore_cache_module(mock_modules, saved):
    import importlib
    for name in mock_modules:
        if name in saved:
            sys.modules[name] = saved[name]
        else:
            sys.modules.pop(name, None)
    import aws.osml.jupyter.cache as cache_mod
    importlib.reload(cache_mod)


class TestImageSessionDataclass:
    """Tests for ImageSession dataclass"""

    def test_image_session_has_all_fields(self):
        """ImageSession dataclass has required fields"""
        modules, _ = _build_mock_modules()
        cache_module, saved = _patch_cache_module(modules)
        try:
            session = cache_module.ImageSession(
                reader=MockReader(),
                asset=MockAsset(width=1024, height=768),
                pyramid=MockPyramid(),
                display=MockProcessingChain(),
                chip_factory=MockChipFactory(),
                sensor_model=MockSensorModel(),
                width=1024,
                height=768,
            )

            assert session.width == 1024
            assert session.height == 768
            assert session.sensor_model is not None
            assert session.reader is not None
        finally:
            _restore_cache_module(modules, saved)

    def test_image_session_sensor_model_optional(self):
        """ImageSession allows None sensor_model"""
        modules, _ = _build_mock_modules()
        cache_module, saved = _patch_cache_module(modules)
        try:
            session = cache_module.ImageSession(
                reader=MockReader(),
                asset=MockAsset(),
                pyramid=MockPyramid(),
                display=MockProcessingChain(),
                chip_factory=MockChipFactory(),
                sensor_model=None,
                width=512,
                height=512,
            )
            assert session.sensor_model is None
        finally:
            _restore_cache_module(modules, saved)


class TestLoadImage:
    """Tests for AdvancedCacheManager.load_image()"""

    def test_creates_session(self):
        """load_image creates and returns an ImageSession"""
        mock_reader = MockReader()
        mock_chip = MockChipFactory()

        modules, mocks = _build_mock_modules(
            io_open_return=mock_reader,
            load_sensor_model_return=MockSensorModel(),
            chip_factory_return=mock_chip,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            session = cm.load_image("/path/to/image.ntf")

            assert session is not None
            assert session.width == 512
            assert session.height == 512
            assert session.sensor_model is not None
        finally:
            _restore_cache_module(modules, saved)

    def test_returns_cached_on_second_call(self):
        """load_image returns the same session for repeated calls"""
        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            session1 = cm.load_image("/path/to/image.ntf")
            session2 = cm.load_image("/path/to/image.ntf")

            assert session1 is session2
            mocks["io_cls"].open.assert_called_once()
        finally:
            _restore_cache_module(modules, saved)

    def test_uses_adaptive_statistics_when_single_level(self):
        """load_image uses compute_image_statistics for single-level pyramids"""
        single_level = MockPyramid(num_levels=1)

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            pyramid_from_dataset_return=single_level,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/path/to/image.ntf")

            mocks["compute_stats"].assert_called_once()
            mocks["build_levels"].assert_not_called()
        finally:
            _restore_cache_module(modules, saved)

    def test_uses_pyramid_statistics_when_multi_level(self):
        """load_image uses pyramid.compute_statistics when it has > 1 level"""
        multi_level = MockPyramid(num_levels=4)

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            pyramid_from_dataset_return=multi_level,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/path/to/image.ntf")

            mocks["compute_stats"].assert_not_called()
            mocks["build_levels"].assert_not_called()
        finally:
            _restore_cache_module(modules, saved)

    def test_raises_on_failure(self):
        """load_image wraps exceptions in RuntimeError"""
        modules, mocks = _build_mock_modules()
        mocks["io_cls"].open.side_effect = FileNotFoundError("not found")
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            with pytest.raises(RuntimeError, match="Failed to load image"):
                cm.load_image("/nonexistent.ntf")
        finally:
            _restore_cache_module(modules, saved)

    def test_sensor_model_can_be_none(self):
        """load_image succeeds even when load_sensor_model returns None"""
        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=None,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            session = cm.load_image("/path/to/image.ntf")
            assert session.sensor_model is None
        finally:
            _restore_cache_module(modules, saved)


class TestLoadImageComplex:
    """Tests for complex imagery (SICD) handling in load_image"""

    def test_complex_image_calls_remap(self):
        """load_image uses load_complex_remap for complex imagery"""
        mock_remapped = MagicMock()
        mock_remapped.num_columns = 512
        mock_remapped.num_rows = 512
        mock_remapped.block_grid_size = (1, 1)

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            is_complex_return=True,
            load_complex_remap_return=mock_remapped,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/path/to/sicd.ntf")

            mocks["is_complex"].assert_called_once()
            mocks["load_complex_remap"].assert_called_once()
        finally:
            _restore_cache_module(modules, saved)

    def test_complex_image_builds_display_chain_on_remapped(self):
        """DisplayChainFactory.build receives the remapped source for complex images"""
        mock_remapped = MagicMock()
        mock_remapped.num_columns = 512
        mock_remapped.num_rows = 512
        mock_remapped.block_grid_size = (1, 1)

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            is_complex_return=True,
            load_complex_remap_return=mock_remapped,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/path/to/sicd.ntf")

            call_args = mocks["display_cls"].build.call_args
            assert call_args[0][0] is mock_remapped
        finally:
            _restore_cache_module(modules, saved)

    def test_complex_image_chip_factory_uses_remapped_source(self):
        """ChipFactory source is a TiledImagePyramid wrapping the remapped provider"""
        mock_remapped = MagicMock()
        mock_remapped.num_columns = 512
        mock_remapped.num_rows = 512
        mock_remapped.block_grid_size = (1, 1)

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            is_complex_return=True,
            load_complex_remap_return=mock_remapped,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/path/to/sicd.ntf")

            call_kwargs = mocks["chip_cls"].call_args[1]
            mocks["pyramid_cls"].assert_called_with([mock_remapped])
            assert call_kwargs["source"] is mocks["pyramid_cls"].return_value
        finally:
            _restore_cache_module(modules, saved)

    def test_non_complex_skips_remap(self):
        """load_image does not call load_complex_remap for non-complex imagery"""
        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            is_complex_return=False,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/path/to/image.ntf")

            mocks["is_complex"].assert_called_once()
            mocks["load_complex_remap"].assert_not_called()
        finally:
            _restore_cache_module(modules, saved)

    def test_complex_image_statistics_from_remapped(self):
        """Statistics are computed on the remapped source for complex images"""
        mock_remapped = MagicMock()
        mock_remapped.num_columns = 512
        mock_remapped.num_rows = 512
        mock_remapped.block_grid_size = (1, 1)

        single_level = MockPyramid(num_levels=1)

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            pyramid_from_dataset_return=single_level,
            is_complex_return=True,
            load_complex_remap_return=mock_remapped,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/path/to/sicd.ntf")

            call_args = mocks["compute_stats"].call_args
            assert call_args[0][0] is mock_remapped
        finally:
            _restore_cache_module(modules, saved)


class TestUnloadImage:
    """Tests for AdvancedCacheManager.unload_image()"""

    def test_removes_session_and_closes_reader(self):
        """unload_image removes the session and closes the reader"""
        mock_reader = MockReader()

        modules, mocks = _build_mock_modules(
            io_open_return=mock_reader,
            load_sensor_model_return=MockSensorModel(),
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/path/to/image.ntf")

            result = cm.unload_image("/path/to/image.ntf")

            assert result is True
            assert mock_reader._closed is True
            assert cm.get_image_session("/path/to/image.ntf") is None
        finally:
            _restore_cache_module(modules, saved)

    def test_returns_false_for_unknown(self):
        """unload_image returns False for an unknown dataset"""
        modules, _ = _build_mock_modules()
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            result = cm.unload_image("/nonexistent.ntf")
            assert result is False
        finally:
            _restore_cache_module(modules, saved)


class TestGetImageSession:
    """Tests for AdvancedCacheManager.get_image_session()"""

    def test_returns_none_for_unknown(self):
        """get_image_session returns None when dataset not loaded"""
        modules, _ = _build_mock_modules()
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            assert cm.get_image_session("/unknown") is None
        finally:
            _restore_cache_module(modules, saved)

    def test_tracks_hits_and_misses(self):
        """get_image_session increments hit/miss counters"""
        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()

            cm.get_image_session("/miss")
            assert cm.cache_stats['misses'] == 1
            assert cm.cache_stats['hits'] == 0

            cm.load_image("/path/to/image.ntf")
            cm.get_image_session("/path/to/image.ntf")
            assert cm.cache_stats['hits'] == 1
        finally:
            _restore_cache_module(modules, saved)


class TestRSetDetection:
    """Tests for _detect_rset_paths()"""

    def test_detects_rset_files(self, tmp_path):
        """R-Set files are included in the path list"""
        base = tmp_path / "image.ntf"
        base.touch()
        (tmp_path / "image.ntf.r1").touch()
        (tmp_path / "image.ntf.r2").touch()
        (tmp_path / "image.ntf.r3").touch()

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image(str(base))

            call_args = mocks["io_cls"].open.call_args[0]
            paths = call_args[0]
            assert isinstance(paths, list)
            assert len(paths) == 4
            assert paths[0] == str(base)
        finally:
            _restore_cache_module(modules, saved)

    def test_no_rset_passes_string(self, tmp_path):
        """Without R-Set files, a plain string path is passed"""
        base = tmp_path / "image.ntf"
        base.touch()

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image(str(base))

            call_args = mocks["io_cls"].open.call_args[0]
            paths = call_args[0]
            assert isinstance(paths, str)
        finally:
            _restore_cache_module(modules, saved)


class TestLoadOverlay:
    """Tests for AdvancedCacheManager.load_overlay()"""

    def test_uses_projector(self, tmp_path):
        """load_overlay creates a Projector and calls project_features"""
        fc = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [1, 2]}, "properties": {"id": "1"}}
            ]
        }
        overlay_path = tmp_path / "overlay.geojson"
        overlay_path.write_text(json.dumps(fc))

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = fc["features"]

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            cm.load_overlay("/img.ntf", str(overlay_path))

            mocks["projector_cls"].assert_called_once()
            proj_instance.project_features.assert_called_once()
        finally:
            _restore_cache_module(modules, saved)

    def test_projector_receives_correct_bounds(self, tmp_path):
        """Projector is constructed with (0, 0, width, height)"""
        fc = {"type": "FeatureCollection", "features": []}
        overlay_path = tmp_path / "overlay.geojson"
        overlay_path.write_text(json.dumps(fc))

        asset = MockAsset(width=2048, height=1024)
        reader = MockReader(asset=asset)

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = []

        modules, mocks = _build_mock_modules(
            io_open_return=reader,
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            cm.load_overlay("/img.ntf", str(overlay_path))

            call_kwargs = mocks["projector_cls"].call_args[1]
            assert call_kwargs["image_bounds"] == (0.0, 0.0, 2048.0, 1024.0)
        finally:
            _restore_cache_module(modules, saved)

    def test_raises_without_sensor_model(self, tmp_path):
        """load_overlay raises when no sensor model available"""
        fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {}}]}
        overlay_path = tmp_path / "overlay.geojson"
        overlay_path.write_text(json.dumps(fc))

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=None,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()

            with pytest.raises(RuntimeError, match="No sensor model"):
                cm.load_overlay("/img.ntf", str(overlay_path))
        finally:
            _restore_cache_module(modules, saved)

    def test_returns_cached_on_second_call(self, tmp_path):
        """load_overlay returns cached index on repeated calls"""
        fc = {"type": "FeatureCollection", "features": []}
        overlay_path = tmp_path / "overlay.geojson"
        overlay_path.write_text(json.dumps(fc))

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = []

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            idx1 = cm.load_overlay("/img.ntf", str(overlay_path))
            idx2 = cm.load_overlay("/img.ntf", str(overlay_path))

            assert idx1 is idx2
            assert mocks["projector_cls"].call_count == 1
        finally:
            _restore_cache_module(modules, saved)

    def test_auto_loads_image_if_needed(self, tmp_path):
        """load_overlay loads the image if not already cached"""
        fc = {"type": "FeatureCollection", "features": []}
        overlay_path = tmp_path / "overlay.geojson"
        overlay_path.write_text(json.dumps(fc))

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = []

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_overlay("/img.ntf", str(overlay_path))

            mocks["io_cls"].open.assert_called_once()
        finally:
            _restore_cache_module(modules, saved)


class TestAddOverlayFeatures:
    """Tests for AdvancedCacheManager.add_overlay_features() (in-memory path)"""

    def _feature(self, fid="1"):
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [1, 2]},
            "properties": {"id": fid},
        }

    def test_accepts_feature_collection_dict(self):
        """add_overlay_features accepts a FeatureCollection dict"""
        features = [self._feature("a"), self._feature("b")]
        fc = {"type": "FeatureCollection", "features": features}

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = features

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            cm.add_overlay_features("/img.ntf", "layer1", fc)

            mocks["projector_cls"].assert_called_once()
            passed = proj_instance.project_features.call_args[0][0]
            assert passed == features
        finally:
            _restore_cache_module(modules, saved)

    def test_accepts_list_of_features(self):
        """add_overlay_features accepts a plain list of Feature dicts"""
        features = [self._feature("a"), self._feature("b")]

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = features

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            cm.add_overlay_features("/img.ntf", "layer1", features)

            passed = proj_instance.project_features.call_args[0][0]
            assert passed == features
        finally:
            _restore_cache_module(modules, saved)

    def test_accepts_geo_interface_object(self):
        """add_overlay_features accepts an object exposing __geo_interface__"""
        features = [self._feature("a")]

        class FakeGeoDataFrame:
            @property
            def __geo_interface__(self):
                return {"type": "FeatureCollection", "features": features}

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = features

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            cm.add_overlay_features("/img.ntf", "layer1", FakeGeoDataFrame())

            passed = proj_instance.project_features.call_args[0][0]
            assert passed == features
        finally:
            _restore_cache_module(modules, saved)

    def test_accepts_single_feature_dict(self):
        """add_overlay_features accepts a single Feature dict"""
        feature = self._feature("a")

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = [feature]

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            cm.add_overlay_features("/img.ntf", "layer1", feature)

            passed = proj_instance.project_features.call_args[0][0]
            assert passed == [feature]
        finally:
            _restore_cache_module(modules, saved)

    def test_registers_index_under_layer_key(self):
        """The index is retrievable by OverlayTileProcessor's key format"""
        features = [self._feature("a")]

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = features

        sentinel_index = MagicMock(name="index")

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
            index_return=sentinel_index,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            cm.add_overlay_features("/img.ntf", "layer1", features)

            assert cm.get_overlay_index("/img.ntf:layer1") is sentinel_index
        finally:
            _restore_cache_module(modules, saved)

    def test_same_name_replaces_index(self):
        """Re-adding under the same name replaces the existing index"""
        features = [self._feature("a")]

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = features

        first_index = MagicMock(name="first")
        second_index = MagicMock(name="second")

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        mocks["index_cls"].side_effect = [first_index, second_index]
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")

            idx1 = cm.add_overlay_features("/img.ntf", "layer1", features)
            idx2 = cm.add_overlay_features("/img.ntf", "layer1", features)

            assert idx1 is first_index
            assert idx2 is second_index
            assert cm.get_overlay_index("/img.ntf:layer1") is second_index
            assert len(cm.overlay_indices) == 1
        finally:
            _restore_cache_module(modules, saved)

    def test_raises_without_sensor_model(self):
        """add_overlay_features raises when the image has no sensor model"""
        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=None,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            with pytest.raises(ValueError, match="No sensor model"):
                cm.add_overlay_features("/img.ntf", "layer1", [self._feature()])
        finally:
            _restore_cache_module(modules, saved)

    def test_auto_loads_image_if_needed(self):
        """add_overlay_features loads the image if not already cached"""
        features = [self._feature("a")]

        proj_instance = MagicMock()
        proj_instance.project_features.return_value = features

        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
            projector_return=proj_instance,
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.add_overlay_features("/img.ntf", "layer1", features)

            mocks["io_cls"].open.assert_called_once()
        finally:
            _restore_cache_module(modules, saved)

    def test_rejects_unsupported_input(self):
        """add_overlay_features raises a clear error for unsupported inputs"""
        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            with pytest.raises(ValueError, match="Unsupported features input"):
                cm.add_overlay_features("/img.ntf", "layer1", "not-features")
        finally:
            _restore_cache_module(modules, saved)

    def test_rejects_wrong_geojson_dict_type(self):
        """add_overlay_features raises for a GeoJSON dict that is not a FC/Feature"""
        modules, mocks = _build_mock_modules(
            io_open_return=MockReader(),
            load_sensor_model_return=MockSensorModel(),
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            with pytest.raises(ValueError, match="Unsupported GeoJSON dict"):
                cm.add_overlay_features(
                    "/img.ntf", "layer1", {"type": "Point", "coordinates": [0, 0]}
                )
        finally:
            _restore_cache_module(modules, saved)


class TestUnloadOverlay:
    """Tests for AdvancedCacheManager.unload_overlay()"""

    def test_removes_cached_index(self):
        """unload_overlay removes the cached index"""
        modules, _ = _build_mock_modules()
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.overlay_indices["img:overlay"] = MagicMock()

            result = cm.unload_overlay("img", "overlay")
            assert result is True
            assert cm.get_overlay_index("img:overlay") is None
        finally:
            _restore_cache_module(modules, saved)

    def test_returns_false_for_unknown(self):
        """unload_overlay returns False for unknown overlay"""
        modules, _ = _build_mock_modules()
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            result = cm.unload_overlay("img", "missing")
            assert result is False
        finally:
            _restore_cache_module(modules, saved)


class TestGetOverlayIndex:
    """Tests for AdvancedCacheManager.get_overlay_index()"""

    def test_hit_tracking(self):
        """get_overlay_index tracks hits"""
        modules, _ = _build_mock_modules()
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.overlay_indices["key"] = MagicMock()

            cm.get_overlay_index("key")
            assert cm.cache_stats['hits'] == 1
        finally:
            _restore_cache_module(modules, saved)

    def test_miss_tracking(self):
        """get_overlay_index tracks misses"""
        modules, _ = _build_mock_modules()
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.get_overlay_index("missing")
            assert cm.cache_stats['misses'] == 1
        finally:
            _restore_cache_module(modules, saved)


class TestAddOverlayFeaturesRealToolkit:
    """Regression tests for the image-space indexing path using the REAL toolkit.

    The other add_overlay_features tests fully mock ``aws.osml.features``, so they
    cannot catch the Projector silently dropping features that carry only an
    ``imageBBox`` (``geometry=None``). These tests exercise the genuine
    ``Projector`` / ``ImagedFeaturePropertyAccessor`` / ``STRFeature2DSpatialIndex``
    against a stubbed image session — the exact path ``viewer.add_layer`` uses.
    """

    def _real_toolkit_available(self):
        try:
            import aws.osml.features  # noqa: F401
            import shapely  # noqa: F401
            import geojson  # noqa: F401
        except Exception:
            return False
        return True

    def _make_cache_with_session(self, width=4000, height=4000):
        """A real AdvancedCacheManager with a stubbed in-memory image session.

        The sensor model is identity-ish: it never has to project image-space
        features (those already carry an image geometry after normalization), so
        ``world_to_image`` is intentionally not exercised for imageBBox inputs.
        """
        import aws.osml.jupyter.cache as cache_module

        class IdentitySensorModel:
            def world_to_image(self, world_coord):
                raise AssertionError(
                    "image-space features should not be reprojected through the sensor model"
                )

            def image_to_world(self, image_coord):
                return MagicMock()

        cm = cache_module.AdvancedCacheManager()
        session = MagicMock()
        session.sensor_model = IdentitySensorModel()
        session.width = width
        session.height = height
        cm.image_sessions["/img.tiff"] = session
        return cm

    def test_image_bbox_only_features_are_indexed(self):
        """imageBBox-only features (geometry=None) survive indexing and are findable.

        This is the viewer.add_layer bug: without normalizing imageBBox ->
        imageGeometry, the Projector drops every such feature and the rendered
        layer is empty even though it appears in the layer list.
        """
        if not self._real_toolkit_available():
            pytest.skip("real aws.osml.features toolkit not installed")

        import geojson
        import shapely

        cm = self._make_cache_with_session()
        features = [
            geojson.Feature(
                geometry=None,
                properties={"imageBBox": [1000, 750, 1050, 800], "object_class": "vehicle"},
            ),
            geojson.Feature(
                geometry=None,
                properties={"imageBBox": [2000, 1500, 2075, 1575], "object_class": "building"},
            ),
        ]

        index = cm.add_overlay_features("/img.tiff", "detections", features)

        hits = index.find_intersects(shapely.box(0, 0, 4000, 4000))
        assert len(hits) == 2
        # Normalization wrote imageGeometry so the STRtree can index in image space.
        assert all("imageGeometry" in f["properties"] for f in hits)

    def test_image_bbox_feature_findable_in_its_tile(self):
        """A bbox feature is returned by an overlay-tile-style bbox query covering it."""
        if not self._real_toolkit_available():
            pytest.skip("real aws.osml.features toolkit not installed")

        import geojson
        import shapely

        cm = self._make_cache_with_session()
        features = [
            geojson.Feature(
                geometry=None,
                properties={"imageBBox": [1000, 750, 1050, 800], "object_class": "vehicle"},
            )
        ]
        index = cm.add_overlay_features("/img.tiff", "detections", features)

        # A tile bbox that covers the detection returns it; a disjoint one does not.
        covering = index.find_intersects(shapely.box(900, 700, 1100, 900))
        disjoint = index.find_intersects(shapely.box(0, 0, 500, 500))
        assert len(covering) == 1
        assert len(disjoint) == 0

    def test_image_geometry_features_still_indexed(self):
        """Features already carrying imageGeometry continue to index (no regression)."""
        if not self._real_toolkit_available():
            pytest.skip("real aws.osml.features toolkit not installed")

        import geojson
        import shapely

        cm = self._make_cache_with_session()
        features = [
            geojson.Feature(
                geometry=None,
                properties={
                    "imageGeometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [[1000, 750], [1050, 750], [1050, 800], [1000, 800], [1000, 750]]
                        ],
                    }
                },
            )
        ]
        index = cm.add_overlay_features("/img.tiff", "detections", features)
        hits = index.find_intersects(shapely.box(0, 0, 4000, 4000))
        assert len(hits) == 1


class TestModelResultsCache:
    """Tests for model results cache (unchanged logic)"""

    def test_cache_and_retrieve(self):
        """cache_model_results stores and get_model_results retrieves"""
        from aws.osml.jupyter.cache import AdvancedCacheManager
        cm = AdvancedCacheManager()
        features = [{"type": "Feature", "properties": {"score": 0.95}}]

        cm.cache_model_results("img.ntf", "endpoint1", 0, 1, 2, features)
        result = cm.get_model_results("img.ntf", "endpoint1", 0, 1, 2)
        assert result == features

    def test_miss_returns_none(self):
        """get_model_results returns None on miss"""
        from aws.osml.jupyter.cache import AdvancedCacheManager
        cm = AdvancedCacheManager()
        result = cm.get_model_results("img.ntf", "ep", 0, 0, 0)
        assert result is None

    def test_clear_for_dataset(self):
        """clear_model_cache_for_dataset removes only matching entries"""
        from aws.osml.jupyter.cache import AdvancedCacheManager
        cm = AdvancedCacheManager()
        cm.cache_model_results("img1.ntf", "ep", 0, 0, 0, [{"f": 1}])
        cm.cache_model_results("img2.ntf", "ep", 0, 0, 0, [{"f": 2}])

        cm.clear_model_cache_for_dataset("img1.ntf")

        assert cm.get_model_results("img1.ntf", "ep", 0, 0, 0) is None
        assert cm.get_model_results("img2.ntf", "ep", 0, 0, 0) == [{"f": 2}]

    def test_eviction_at_capacity(self):
        """Cache evicts oldest entries when at max capacity"""
        from aws.osml.jupyter.cache import AdvancedCacheManager
        cm = AdvancedCacheManager()
        for i in range(1000):
            cm.cache_model_results("img", "ep", 0, 0, i, [{"idx": i}])

        assert len(cm.model_results_cache) == 1000

        cm.cache_model_results("img", "ep", 0, 0, 1000, [{"idx": 1000}])
        assert len(cm.model_results_cache) <= 901


class TestClearAllCaches:
    """Tests for clear_all_caches"""

    def test_closes_readers_and_clears(self):
        """clear_all_caches closes all readers and empties all caches"""
        mock_reader = MockReader()

        modules, mocks = _build_mock_modules(
            io_open_return=mock_reader,
            load_sensor_model_return=MockSensorModel(),
        )
        cache_module, saved = _patch_cache_module(modules)
        try:
            cm = cache_module.AdvancedCacheManager()
            cm.load_image("/img.ntf")
            cm.cache_model_results("img", "ep", 0, 0, 0, [])

            cm.clear_all_caches()

            assert mock_reader._closed is True
            assert len(cm.image_sessions) == 0
            assert len(cm.overlay_indices) == 0
            assert len(cm.model_results_cache) == 0
            assert cm.cache_stats == {'hits': 0, 'misses': 0}
        finally:
            _restore_cache_module(modules, saved)


class TestNoGDALImports:
    """Verify no GDAL/osgeo imports remain in source"""

    def test_no_gdal_references(self):
        """aws.osml.jupyter/cache.py has no references to osgeo or GDAL APIs"""
        content = OSML_KERNEL_CACHE_PATH.read_text()

        assert 'from osgeo' not in content
        assert 'import gdal' not in content
        assert 'GDALTileFactory' not in content
        assert 'GDALImageFormats' not in content
        assert 'GDALCompressionOptions' not in content
        assert 'RangeAdjustmentType' not in content
        assert 'load_gdal_dataset' not in content
        assert 'gdalconst' not in content

    def test_no_manual_projection_code(self):
        """aws.osml.jupyter/cache.py no longer contains manual projection methods"""
        content = OSML_KERNEL_CACHE_PATH.read_text()

        assert '_project_feature_to_image' not in content
        assert '_convert_bbox_to_image_bbox' not in content
        assert '_convert_geometry_to_image_geometry' not in content
        assert 'get_standard_overviews' not in content
