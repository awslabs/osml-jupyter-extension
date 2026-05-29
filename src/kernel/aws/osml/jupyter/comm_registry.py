# Copyright Amazon.com, Inc. or its affiliates.


class CommRegistry:
    """Tracks all live osml_comm_target comms for this kernel.

    Replaces the single ``comm_ref[0]`` slot used previously, which could only
    remember the most-recently-opened comm and routed replies to the wrong comm
    when more than one was open. The registry keeps every live comm so the
    router can reply on the receiving comm and the push channel can broadcast to
    all of them.
    """

    def __init__(self, logger=None):
        self._comms = []
        self._logger = logger

    def register(self, comm):
        """Add a comm on open. No-op if it is already registered."""
        if comm not in self._comms:
            self._comms.append(comm)

    def unregister(self, comm):
        """Remove a comm on close. No-op if it is not registered."""
        if comm in self._comms:
            self._comms.remove(comm)

    def broadcast(self, message):
        """Send ``message`` to every live comm, pruning any that fail.

        IOPub makes delivery point-to-point by ``comm_id`` anyway, so
        broadcasting survives the viewer having reconnected under a new
        ``comm_id``. Tolerates a dead comm (try/except per comm, prune on
        failure) and returns the count reached.
        """
        reached = 0
        dead = []
        for comm in list(self._comms):
            try:
                comm.send(message)
                reached += 1
            except Exception as e:
                dead.append(comm)
                if self._logger:
                    self._logger.warning(f"Pruning dead comm during broadcast: {e}")

        for comm in dead:
            self.unregister(comm)

        return reached

    def primary(self):
        """Return the most-recently-opened live comm, or None (informational)."""
        return self._comms[-1] if self._comms else None

    def __len__(self):
        return len(self._comms)
