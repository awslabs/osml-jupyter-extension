# Copyright Amazon.com, Inc. or its affiliates.

"""Inbound state-stream processors feeding the kernel-side ``ViewStateStore``.

``VIEW_STATE_UPDATE`` and ``CLICK_EVENT`` are fire-and-forget messages from the
frontend (Design 4d): they form a third message category alongside
request/response and the push channel. Unlike request/response processors these
send **no** ``*_RESPONSE`` — the kernel updates the store silently to keep the
hot path cheap. Malformed payloads are validated, logged, and dropped without
crashing the router.
"""


class ViewStateUpdateProcessor:
    """Handle ``VIEW_STATE_UPDATE`` — store the settled view rectangle."""

    _REQUIRED_FIELDS = ['minx', 'miny', 'maxx', 'maxy', 'zoom']

    def __init__(self, store, logger):
        self.store = store
        self.logger = logger

    def process(self, data, comm):
        missing = [field for field in self._REQUIRED_FIELDS if field not in data]
        if missing:
            self.logger.error(
                f"Dropping malformed VIEW_STATE_UPDATE, missing fields: {missing}"
            )
            return

        try:
            self.store.update_view(data)
        except Exception as e:
            # Fire-and-forget: never reply, never crash the router.
            self.logger.log_error_detailed("view_state_update", e, data)


class ClickEventProcessor:
    """Handle ``CLICK_EVENT`` — store the last click in image space."""

    _REQUIRED_FIELDS = ['x', 'y']

    def __init__(self, store, logger):
        self.store = store
        self.logger = logger

    def process(self, data, comm):
        missing = [field for field in self._REQUIRED_FIELDS if field not in data]
        if missing:
            self.logger.error(
                f"Dropping malformed CLICK_EVENT, missing fields: {missing}"
            )
            return

        try:
            self.store.update_click(data)
        except Exception as e:
            # Fire-and-forget: never reply, never crash the router.
            self.logger.log_error_detailed("click_event", e, data)
