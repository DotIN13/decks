"""One jev-ultrafast run, as a subprocess the Decks server watches.

The server (`apps/server/src/web/jev.ts`) launches a Chromium of its own, points
browser-harness at it with BU_CDP_URL, and spawns this script with one JSON argument:
`{"url": ..., "goal": ...}`. Each decision cycle comes back as one JSON line on
stdout, so the server never holds a Python object — only a transcript of states:

    {"t": "state", "status": "ready", "elapsed_ms": 1200, "steps": 2, "url": ..., "last": {...}}
    {"t": "end", "status": "done", "elapsed_ms": 7100, "steps": 9, "url": ...}
    {"t": "error", "note": "one sentence"}

SIGTERM raises SystemExit so the finally block still stops the harness daemon this
run started; the server sends it on stop() and on its timeout.
"""

import json
import os
import signal
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def line_of(snapshot):
    last = snapshot["history"][-1] if snapshot["history"] else None
    return {
        "t": "state",
        "status": snapshot["status"],
        "elapsed_ms": snapshot["elapsed_ms"],
        "steps": len(snapshot["history"]),
        "url": snapshot["page"].get("url"),
        **(
            {
                "last": {
                    "action": last["action"],
                    "operation": last["operation"],
                    "text": last["text"],
                    # How long the decision took, and how long the text helper took, so a run's
                    # wall time can be split into thinking and everything else.
                    "model_ms": last.get("latency_ms", 0),
                    "text_ms": last.get("text_latency_ms", 0),
                }
            }
            if last
            else {}
        ),
    }


def main():
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    spec = json.loads(sys.argv[1])
    snapshot = None
    try:
        # Where the model calls go, before the agent is imported: the agent binds the model
        # module's functions as it loads. It does nothing unless this machine needs it.
        from decision_chat import install

        install()

        from jev_ultrafast import Agent

        with Agent(spec["url"], spec["goal"]) as agent:
            emit(line_of(agent.snapshot()))
            for snapshot in agent.run():
                emit(line_of(snapshot))
        emit(
            {
                "t": "end",
                "status": snapshot["status"] if snapshot else "blocked",
                "elapsed_ms": snapshot["elapsed_ms"] if snapshot else 0,
                "steps": len(snapshot["history"]) if snapshot else 0,
                "url": snapshot["page"].get("url") if snapshot else spec["url"],
            }
        )
    except SystemExit:
        raise
    except KeyError as error:
        if str(error) == "'TYPESAFE_API_KEY'":
            emit({"t": "error", "note": "TYPESAFE_API_KEY is not set, and the decision model cannot be asked without it."})
        else:
            emit({"t": "error", "note": f"Missing {error}."})
        raise SystemExit(1)
    except Exception as error:  # noqa: BLE001 - one line out is the contract
        emit({"t": "error", "note": str(error) or type(error).__name__})
        raise SystemExit(1)
    finally:
        # This run's harness daemon is its own (BH_RUNTIME_DIR is a per-run directory),
        # so stopping it here is what keeps runs from leaving one Python process each.
        try:
            from browser_harness.admin import stop_remote_daemon

            stop_remote_daemon(os.environ.get("BU_NAME", "default"))
        except Exception:
            pass


if __name__ == "__main__":
    main()
