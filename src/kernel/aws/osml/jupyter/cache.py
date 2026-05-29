# Copyright Amazon.com, Inc. or its affiliates.

import glob
import time
from dataclasses import dataclass
from typing import Dict, Optional

import geojson

from aws.osml.io import IO
from aws.osml.metadata import load_sensor_model
from aws.osml.image_processing import (
    TiledImagePyramid,
    DisplayChainFactory,
    ChipFactory,
    SamplingStrategy,
    is_complex,
    load_complex_remap,
)
from aws.osml.image_processing.tile_cache import TileCache
from aws.osml.image_processing.statistics import compute_image_statistics
from aws.osml.features import (
    STRFeature2DSpatialIndex,
    ImagedFeaturePropertyAccessor,
    Projector,
)


@dataclass
class ImageSession:
    reader: object
    asset: object
    pyramid: TiledImagePyramid
    display: object
    chip_factory: ChipFactory
    sensor_model: Optional[object]
    width: int
    height: int
    native_num_levels: int = 1


def _detect_rset_paths(base_path: str):
    rset_paths = sorted(glob.glob(f"{base_path}.r[0-9]*"))
    if rset_paths:
        return [base_path] + rset_paths
    return base_path


class AdvancedCacheManager:
    """Centralized cache management with lifecycle support"""

    def __init__(self):
        self.image_sessions: Dict[str, ImageSession] = {}
        self.overlay_indices: Dict[str, STRFeature2DSpatialIndex] = {}
        self.metadata_cache = {}
        self.statistics_cache = {}
        self.endpoint_cache = {}
        self.model_results_cache = {}
        self.cache_stats = {'hits': 0, 'misses': 0}
        self.tile_cache = TileCache()

    def get_image_session(self, dataset):
        session = self.image_sessions.get(dataset)
        if session:
            self.cache_stats['hits'] += 1
        else:
            self.cache_stats['misses'] += 1
        return session

    def load_image(self, dataset):
        if dataset in self.image_sessions:
            return self.image_sessions[dataset]

        try:
            paths = _detect_rset_paths(dataset)
            reader = IO.open(paths, "r")
            asset = reader.get_asset("image:0")
            sensor_model = load_sensor_model(reader)

            pyramid = TiledImagePyramid.from_dataset(reader)
            native_num_levels = pyramid.num_levels

            if is_complex(asset):
                remapped = load_complex_remap(reader, asset_key="image:0", cache=self.tile_cache)
                stats = self._compute_statistics_adaptive(remapped)
                chain = DisplayChainFactory.build(remapped, stats=stats)
                chip_factory = ChipFactory(
                    source=TiledImagePyramid([remapped]),
                    output_format="png",
                    processing_chain=chain,
                    sensor_model=sensor_model,
                )
            else:
                if pyramid.num_levels <= 1:
                    stats = self._compute_statistics_adaptive(asset)
                else:
                    stats = pyramid.compute_statistics()

                chain = DisplayChainFactory.build(asset, stats=stats)
                chip_factory = ChipFactory(
                    source=pyramid,
                    output_format="png",
                    processing_chain=chain,
                    sensor_model=sensor_model,
                )

            session = ImageSession(
                reader=reader,
                asset=asset,
                pyramid=pyramid,
                display=chain,
                chip_factory=chip_factory,
                sensor_model=sensor_model,
                width=asset.num_columns,
                height=asset.num_rows,
                native_num_levels=native_num_levels,
            )
            self.image_sessions[dataset] = session
            return session
        except Exception as e:
            raise RuntimeError(f"Failed to load image dataset '{dataset}': {str(e)}")

    def _compute_statistics_adaptive(self, asset, num_bins=0):
        block_count = asset.block_grid_size[0] * asset.block_grid_size[1]
        if block_count > 100:
            sample_rate = min(1.0, 64.0 / block_count)
            return compute_image_statistics(
                asset,
                num_bins=num_bins,
                sampling=SamplingStrategy.BLOCK,
                sample_rate=sample_rate,
                num_workers=4,
            )
        return compute_image_statistics(asset, num_bins=num_bins)

    def unload_image(self, dataset):
        session = self.image_sessions.pop(dataset, None)
        if session is None:
            return False
        session.reader.close()
        return True

    def get_overlay_index(self, key):
        index = self.overlay_indices.get(key)
        if index:
            self.cache_stats['hits'] += 1
        else:
            self.cache_stats['misses'] += 1
        return index

    def load_overlay(self, image_name, overlay_name):
        key = f"{image_name}:{overlay_name}"
        if key in self.overlay_indices:
            return self.overlay_indices[key]

        try:
            with open(overlay_name, "r") as f:
                fc = geojson.load(f)

            return self._index_features(image_name, overlay_name, fc['features'])
        except Exception as e:
            raise RuntimeError(f"Failed to load overlay '{overlay_name}': {str(e)}")

    def add_overlay_features(self, image_name, layer_name, features):
        """Index in-memory features into an overlay layer.

        Accepts a GeoJSON FeatureCollection dict, a list of Feature dicts, or any
        object exposing ``__geo_interface__`` (e.g. a GeoDataFrame — duck-typed, no
        hard geopandas dependency). Re-adding under an existing ``layer_name``
        replaces that layer's index.
        """
        feature_list = self._coerce_features(features)
        return self._index_features(image_name, layer_name, feature_list)

    @staticmethod
    def _coerce_features(features):
        """Normalize supported feature inputs to a plain list of Feature dicts."""
        if hasattr(features, "__geo_interface__"):
            features = features.__geo_interface__

        if isinstance(features, dict):
            feature_type = features.get("type")
            if feature_type == "FeatureCollection":
                return list(features.get("features", []))
            if feature_type == "Feature":
                return [features]
            raise ValueError(
                "Unsupported GeoJSON dict: expected a FeatureCollection or Feature, "
                f"got type={feature_type!r}"
            )

        if isinstance(features, list):
            return features

        raise ValueError(
            "Unsupported features input: expected a GeoJSON FeatureCollection dict, "
            "a list of Feature dicts, or an object exposing __geo_interface__, "
            f"got {type(features).__name__}"
        )

    def _index_features(self, image_name, key_name, features):
        """Project features to image space and build/replace the STRtree index.

        Shared by the file-based ``load_overlay`` and the in-memory
        ``add_overlay_features``. Always (re)builds the index for
        ``image_name:key_name`` so re-adding under the same name replaces it.
        """
        key = f"{image_name}:{key_name}"

        session = self.get_image_session(image_name)
        if session is None:
            session = self.load_image(image_name)

        if session.sensor_model is None:
            raise ValueError(f"No sensor model available for dataset: {image_name}")

        # Features authored directly in image space (e.g. detection results with
        # an ``imageBBox`` or deprecated ``bounds_imcoords``/``geom_imcoords``
        # props and ``geometry=None``) carry no ``imageGeometry``. The Projector
        # only recognizes ``imageGeometry`` (via ``get_image_geometry``) and a
        # real geographic ``geometry`` — it would silently drop these. Normalize
        # them up front: resolve the image geometry with ``find_image_geometry``
        # (which understands ``imageBBox`` + the deprecated props) and write it
        # to ``imageGeometry`` so the Projector keeps the feature. Features that
        # already have ``imageGeometry`` or a geographic ``geometry`` are left for
        # the Projector to handle.
        accessor = ImagedFeaturePropertyAccessor()
        for feature in features:
            if accessor.get_image_geometry(feature) is None:
                image_geometry = accessor.find_image_geometry(feature)
                if image_geometry is not None:
                    accessor.set_image_geometry(feature, image_geometry)

        projector = Projector(
            property_accessor=accessor,
            sensor_model=session.sensor_model,
            image_bounds=(0.0, 0.0, float(session.width), float(session.height)),
        )
        visible_features = projector.project_features(features)

        fc_projected = geojson.FeatureCollection(visible_features)
        index = STRFeature2DSpatialIndex(fc_projected)
        self.overlay_indices[key] = index
        return index

    def unload_overlay(self, image_name, overlay_name):
        key = f"{image_name}:{overlay_name}"
        return self.overlay_indices.pop(key, None) is not None

    def get_model_results(self, dataset, endpoint, zoom, row, col):
        key = f"{dataset}:{endpoint}:{zoom}:{row}:{col}"
        if key in self.model_results_cache:
            self.cache_stats['hits'] += 1
            cache_entry = self.model_results_cache[key]

            if isinstance(cache_entry, dict) and 'features' in cache_entry:
                cache_entry['access_count'] = cache_entry.get('access_count', 0) + 1
                cache_entry['last_access'] = time.time()
                return cache_entry['features']
            else:
                return cache_entry
        else:
            self.cache_stats['misses'] += 1
            return None

    def cache_model_results(self, dataset, endpoint, zoom, row, col, features):
        key = f"{dataset}:{endpoint}:{zoom}:{row}:{col}"

        max_cache_size = 1000
        if len(self.model_results_cache) >= max_cache_size:
            keys_to_remove = list(self.model_results_cache.keys())[:100]
            for old_key in keys_to_remove:
                del self.model_results_cache[old_key]

        self.model_results_cache[key] = {
            'features': features,
            'timestamp': time.time(),
            'access_count': 1,
        }

    def clear_model_cache_for_dataset(self, dataset):
        keys_to_remove = [
            key for key in self.model_results_cache.keys()
            if key.startswith(f"{dataset}:")
        ]
        for key in keys_to_remove:
            del self.model_results_cache[key]

    def get_cache_info(self):
        return {
            'image_count': len(self.image_sessions),
            'overlay_count': len(self.overlay_indices),
            'metadata_count': len(self.metadata_cache),
            'statistics_count': len(self.statistics_cache),
            'endpoint_count': len(self.endpoint_cache),
            'model_results_count': len(self.model_results_cache),
            'tile_cache_bytes': self.tile_cache.current_bytes,
            'tile_cache_max_bytes': self.tile_cache.max_bytes,
            'cache_stats': self.cache_stats.copy(),
        }

    def clear_all_caches(self):
        for session in self.image_sessions.values():
            session.reader.close()
        self.image_sessions.clear()
        self.overlay_indices.clear()
        self.metadata_cache.clear()
        self.statistics_cache.clear()
        self.endpoint_cache.clear()
        self.model_results_cache.clear()
        self.tile_cache.clear()
        self.cache_stats = {'hits': 0, 'misses': 0}
