# Copyright Amazon.com, Inc. or its affiliates.

import base64

from aws.osml.image_processing import PixelWindow, ImageSize

from aws.osml.jupyter.core import BaseMessageProcessor
from aws.osml.jupyter.responses import ResponseBuilder, handle_errors_enhanced


class ImageLoadProcessor(BaseMessageProcessor):

    @handle_errors_enhanced('IMAGE_LOAD_RESPONSE', 'image_load')
    def process(self, data, comm):
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']

        session = self.cache_manager.load_image(dataset)

        response = ResponseBuilder.success_response('IMAGE_LOAD_RESPONSE', {
            'dataset': dataset,
            'status': 'SUCCESS',
            'width': session.width,
            'height': session.height,
            'numLevels': session.native_num_levels,
        })
        comm.send(response)


class ImageTileProcessor(BaseMessageProcessor):

    @handle_errors_enhanced('IMAGE_TILE_RESPONSE', 'image_tile')
    def process(self, data, comm):
        self.validate_request(data, ['dataset', 'zoom', 'row', 'col'])
        dataset = data['dataset']
        zoom = data['zoom']
        row = data['row']
        col = data['col']

        session = self.cache_manager.get_image_session(dataset)
        if session is None:
            raise ValueError(f"Image not loaded: {dataset}")

        scale = 2 ** (-1 * zoom)
        scaled_tile_size = int(512 * scale)
        src_x = int(col) * scaled_tile_size
        src_y = int(row) * scaled_tile_size

        chip_bytes = session.chip_factory.create_chip(
            PixelWindow(src_x, src_y, scaled_tile_size, scaled_tile_size),
            output_size=ImageSize(512, 512),
        )

        if chip_bytes is None:
            response = ResponseBuilder.success_response('IMAGE_TILE_RESPONSE', {'img': ''})
        else:
            tile_b64 = base64.b64encode(chip_bytes).decode('utf-8')
            response = ResponseBuilder.success_response('IMAGE_TILE_RESPONSE', {'img': tile_b64})
        comm.send(response)


class ImageMetadataProcessor(BaseMessageProcessor):

    @handle_errors_enhanced('IMAGE_METADATA_RESPONSE', 'image_metadata')
    def process(self, data, comm):
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']

        if dataset in self.cache_manager.metadata_cache:
            metadata = self.cache_manager.metadata_cache[dataset]
        else:
            session = self.cache_manager.get_image_session(dataset)
            if session is None:
                session = self.cache_manager.load_image(dataset)
            metadata = self._extract_metadata(session)
            self.cache_manager.metadata_cache[dataset] = metadata

        response = ResponseBuilder.success_response('IMAGE_METADATA_RESPONSE', {
            'dataset': dataset,
            'metadata': metadata,
        })
        comm.send(response)

    def _extract_metadata(self, session):
        return dict(session.asset.metadata) if session.asset.metadata else {}


class ImageStatisticsProcessor(BaseMessageProcessor):

    @handle_errors_enhanced('IMAGE_STATISTICS_RESPONSE', 'image_statistics')
    def process(self, data, comm):
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']
        compute_histogram = data.get('compute_histogram', False)
        histogram_bins = data.get('histogram_bins', 256)

        cache_key = f"{dataset}:{compute_histogram}:{histogram_bins}"
        if cache_key in self.cache_manager.statistics_cache:
            statistics = self.cache_manager.statistics_cache[cache_key]
        else:
            session = self.cache_manager.get_image_session(dataset)
            if session is None:
                session = self.cache_manager.load_image(dataset)
            statistics = self._extract_statistics(session, compute_histogram, histogram_bins)
            self.cache_manager.statistics_cache[cache_key] = statistics

        response = ResponseBuilder.success_response('IMAGE_STATISTICS_RESPONSE', {
            'dataset': dataset,
            'statistics': statistics,
        })
        comm.send(response)

    def _extract_statistics(self, session, compute_histogram, histogram_bins):
        num_bins = histogram_bins if compute_histogram else 0
        if session.pyramid.num_levels <= 1:
            stats = self.cache_manager._compute_statistics_adaptive(
                session.asset,
                num_bins=num_bins,
            )
        else:
            stats = session.pyramid.compute_statistics(num_bins=num_bins)

        statistics = {
            'band_count': len(stats.bands),
            'sample_rate': stats.sample_rate,
            'bands': [],
        }

        for band_idx, band in enumerate(stats.bands):
            band_stats = {
                'band_number': band_idx + 1,
                'min': band.min,
                'max': band.max,
                'mean': band.mean,
                'std': band.stddev,
                'count': band.count,
            }

            if compute_histogram and band.histogram is not None:
                band_stats['histogram'] = {
                    'bins': len(band.histogram),
                    'min': band.min,
                    'max': band.max,
                    'counts': band.histogram.tolist(),
                    'bin_edges': band.bin_edges.tolist(),
                }

            statistics['bands'].append(band_stats)

        return statistics


class ImageUnloadProcessor(BaseMessageProcessor):

    @handle_errors_enhanced('IMAGE_UNLOAD_RESPONSE', 'image_unload')
    def process(self, data, comm):
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']

        unloaded = self.cache_manager.unload_image(dataset)

        self.cache_manager.metadata_cache.pop(dataset, None)
        keys_to_remove = [k for k in self.cache_manager.statistics_cache if k.startswith(f"{dataset}:")]
        for k in keys_to_remove:
            del self.cache_manager.statistics_cache[k]

        response = ResponseBuilder.success_response('IMAGE_UNLOAD_RESPONSE', {
            'dataset': dataset,
            'unloaded': unloaded,
            'result': 'SUCCESS' if unloaded else 'NOT_FOUND',
        })
        comm.send(response)
