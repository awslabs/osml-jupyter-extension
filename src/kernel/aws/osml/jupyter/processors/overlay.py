# Copyright Amazon.com, Inc. or its affiliates.

import shapely

from aws.osml.jupyter.core import BaseMessageProcessor
from aws.osml.jupyter.responses import ResponseBuilder, handle_errors_enhanced


class OverlayTileProcessor(BaseMessageProcessor):
    """Process OVERLAY_TILE_REQUEST messages with proper zoom level handling"""

    ZOOM_FEATURE_LIMITS = {
        -3: 5000,
        -2: 10000,
        -1: 20000,
        0: 50000,
        1: 100000,
        2: 200000,
        3: 500000,
    }

    @handle_errors_enhanced('OVERLAY_TILE_RESPONSE', 'overlay_tile')
    def process(self, data, comm):
        self.validate_request(data, ['imageName', 'overlayName', 'zoom', 'row', 'col'])
        image_name = data['imageName']
        overlay_name = data['overlayName']
        zoom = data['zoom']
        row = data['row']
        col = data['col']

        self.logger.debug(
            f"Processing overlay tile request for image: {image_name}, "
            f"overlay: {overlay_name}, zoom: {zoom}, row: {row}, col: {col}"
        )

        overlay_key = f"{image_name}:{overlay_name}"
        index = self.cache_manager.get_overlay_index(overlay_key)

        if index is None:
            index = self.cache_manager.load_overlay(image_name, overlay_name)

        if index is None:
            raise ValueError(f"Could not load overlay: {overlay_name}")

        scale = 2 ** (-1 * zoom)
        scaled_tile_size = 512 * scale

        bbox = shapely.box(
            int(col) * scaled_tile_size,
            int(row) * scaled_tile_size,
            (int(col) + 1) * scaled_tile_size,
            (int(row) + 1) * scaled_tile_size,
        )

        self.logger.debug(
            f"Zoom level {zoom}: scale={scale}, scaled_tile_size={scaled_tile_size}, bbox={bbox.bounds}"
        )

        try:
            features = index.find_intersects(bbox)
            feature_count = len(features) if features else 0
            self.logger.debug(f"Found {feature_count} intersecting features for overlay tile at zoom {zoom}")

            response = ResponseBuilder.success_response('OVERLAY_TILE_RESPONSE', {'features': features})
            comm.send(response)
        except Exception as e:
            raise e

    def _filter_features_by_zoom(self, features, zoom):
        if not features:
            return features

        feature_limit = self.ZOOM_FEATURE_LIMITS.get(zoom)
        if feature_limit is None:
            if zoom < min(self.ZOOM_FEATURE_LIMITS.keys()):
                feature_limit = self.ZOOM_FEATURE_LIMITS[min(self.ZOOM_FEATURE_LIMITS.keys())]
            else:
                feature_limit = self.ZOOM_FEATURE_LIMITS[max(self.ZOOM_FEATURE_LIMITS.keys())]

        if len(features) <= feature_limit:
            return features

        self.logger.debug(f"Filtering features: {len(features)} -> {feature_limit} for zoom level {zoom}")

        if zoom < 0:
            return self._filter_by_importance(features, feature_limit)
        else:
            return features[:feature_limit]

    def _filter_by_importance(self, features, limit):
        try:
            import shapely.geometry

            feature_areas = []
            for feature in features:
                try:
                    if 'geometry' in feature and feature['geometry']:
                        geom = shapely.geometry.shape(feature['geometry'])
                        area = geom.area if hasattr(geom, 'area') else 0
                        feature_areas.append((area, feature))
                    else:
                        feature_areas.append((0, feature))
                except Exception:
                    feature_areas.append((0, feature))

            feature_areas.sort(key=lambda x: x[0], reverse=True)
            return [feature for area, feature in feature_areas[:limit]]
        except Exception as e:
            self.logger.warning(f"Feature importance filtering failed, using simple truncation: {e}")
            return features[:limit]


class OverlayLoadProcessor(BaseMessageProcessor):
    """Process OVERLAY_LOAD_REQUEST messages"""

    @handle_errors_enhanced('OVERLAY_LOAD_RESPONSE', 'overlay_load')
    def process(self, data, comm):
        self.validate_request(data, ['imageName', 'overlayName'])
        image_name = data['imageName']
        overlay_name = data['overlayName']

        self.logger.debug(
            f"Processing overlay load request for image: {image_name}, overlay: {overlay_name}"
        )

        try:
            index = self.cache_manager.load_overlay(image_name, overlay_name)
            status = "SUCCESS" if index is not None else "FAILED"

            self.logger.info(
                f"Overlay load {'successful' if status == 'SUCCESS' else 'failed'} "
                f"for image: {image_name}, overlay: {overlay_name}"
            )

            response = ResponseBuilder.success_response('OVERLAY_LOAD_RESPONSE', {
                'imageName': image_name,
                'overlayName': overlay_name,
                'status': status,
            })
            comm.send(response)
        except Exception as e:
            raise e


class OverlayUnloadProcessor(BaseMessageProcessor):
    """Process OVERLAY_UNLOAD_REQUEST messages"""

    @handle_errors_enhanced('OVERLAY_UNLOAD_RESPONSE', 'overlay_unload')
    def process(self, data, comm):
        self.validate_request(data, ['imageName', 'overlayName'])
        image_name = data['imageName']
        overlay_name = data['overlayName']

        self.logger.debug(
            f"Processing overlay unload request for image: {image_name}, overlay: {overlay_name}"
        )

        unloaded = self.cache_manager.unload_overlay(image_name, overlay_name)

        response = ResponseBuilder.success_response('OVERLAY_UNLOAD_RESPONSE', {
            'imageName': image_name,
            'overlayName': overlay_name,
            'unloaded': unloaded,
            'result': 'SUCCESS' if unloaded else 'NOT_FOUND',
        })
        comm.send(response)

        if unloaded:
            self.logger.info(f"Successfully unloaded overlay: {image_name}:{overlay_name}")
        else:
            self.logger.info(f"Overlay not found in cache: {image_name}:{overlay_name}")
