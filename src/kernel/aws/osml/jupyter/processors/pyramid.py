# Copyright Amazon.com, Inc. or its affiliates.

import os
import tempfile
import threading

from aws.osml.io import IO
from aws.osml.image_processing import PyramidBuilder, sips_rrds_resample

from aws.osml.jupyter.core import BaseMessageProcessor
from aws.osml.jupyter.responses import ResponseBuilder, handle_errors_enhanced


NITF_EXTENSIONS = {'.ntf', '.nitf'}
TIFF_EXTENSIONS = {'.tif', '.tiff'}


def _determine_format(dataset):
    ext = os.path.splitext(dataset)[1].lower()
    if ext in NITF_EXTENSIONS:
        return 'nitf'
    if ext in TIFF_EXTENSIONS:
        return 'geotiff'
    raise ValueError(
        f"Unsupported format for pyramid build: '{ext}'. Expected .ntf, .nitf, .tif, or .tiff"
    )


def _build_rset_paths(dataset, num_overview_levels):
    paths = [dataset]
    for i in range(1, num_overview_levels + 1):
        paths.append(f"{dataset}.r{i}")
    return paths


def _build_cog_path(dataset):
    base, ext = os.path.splitext(dataset)
    return f"{base}_cog{ext}"


class PyramidBuildProcessor(BaseMessageProcessor):

    @handle_errors_enhanced('PYRAMID_BUILD_RESPONSE', 'pyramid_build')
    def process(self, data, comm):
        self.validate_request(data, ['dataset'])
        dataset = data['dataset']

        thread = threading.Thread(
            target=self._build_pyramid,
            args=(dataset, comm),
            daemon=True,
        )
        thread.start()

    def _build_pyramid(self, dataset, comm):
        try:
            output_path = self._execute_build(dataset, comm)
            response = ResponseBuilder.success_response('PYRAMID_BUILD_RESPONSE', {
                'dataset': dataset,
                'outputPath': output_path,
            })
            comm.send(response)
        except Exception as e:
            response = ResponseBuilder.error_response(
                'PYRAMID_BUILD_RESPONSE',
                f"Pyramid build failed for '{dataset}': {str(e)}",
            )
            comm.send(response)

    def _make_progress_callback(self, dataset, comm, total_levels):
        weights = [4 ** (total_levels - i) for i in range(1, total_levels + 1)]
        total_weight = sum(weights)
        cumulative = [sum(weights[:i]) for i in range(total_levels + 1)]
        last_overall_pct = [-1]

        def on_progress(completed, total, level):
            level_frac = completed / total
            overall_pct = int(
                100.0 * (cumulative[level - 1] + level_frac * weights[level - 1]) / total_weight
            )
            if overall_pct >= last_overall_pct[0] + 2 or (completed == total and level == total_levels):
                last_overall_pct[0] = overall_pct
                comm.send({
                    'type': 'PYRAMID_BUILD_RESPONSE',
                    'status': 'PROGRESS',
                    'dataset': dataset,
                    'completed': completed,
                    'total': total,
                    'level': level,
                    'totalLevels': total_levels,
                    'percent': overall_pct,
                })

        return on_progress

    def _execute_build(self, dataset, comm):
        if not os.path.exists(dataset):
            raise FileNotFoundError(f"File not found: {dataset}")

        fmt = _determine_format(dataset)

        reader = IO.open(dataset, "r")
        source = reader.get_asset("image:0")
        builder = PyramidBuilder(source, resample_func=sips_rrds_resample)
        total_levels = len(builder._levels)

        progress = self._make_progress_callback(dataset, comm, total_levels)
        builder.progress = progress

        if fmt == 'nitf':
            return self._build_nitf_rset(dataset, source, builder)
        else:
            return self._build_cog(dataset, source, builder)

    def _build_nitf_rset(self, dataset, source, builder):
        num_levels = len(builder._levels)
        sidecar_paths = [f"{dataset}.r{i}" for i in range(1, num_levels)]

        with tempfile.NamedTemporaryFile(suffix=".ntf", delete=False) as tmp:
            writer_base = tmp.name
        try:
            writer_paths = [writer_base] + sidecar_paths
            writer = IO.open(writer_paths, "w", "nitf")
            builder.build_and_write(writer, base_key="image:0")
            writer.close()
        finally:
            if os.path.isfile(writer_base):
                os.unlink(writer_base)

        return sidecar_paths[0]

    def _build_cog(self, dataset, source, builder):
        output_path = _build_cog_path(dataset)
        writer = IO.open(output_path, "w", "geotiff")
        writer.add_asset("image:0", source, "", "", ["data"])
        builder.build_and_write(writer, base_key="image:0")
        writer.close()
        return output_path
