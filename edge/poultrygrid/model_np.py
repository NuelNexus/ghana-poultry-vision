"""Numpy-only inference for the exported model (no PyTorch on the Pi)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .features import CAUSES, CAUSE_TITLES, STATUS_LABELS, STATUS_TITLES, fan_policy


class CoopModel:
    def __init__(self, path: str | Path):
        data = np.load(path, allow_pickle=False)
        self.meta = json.loads(str(data["meta"]))
        self.mean = data["mean"]
        self.std = data["std"]
        self.layers = [(data[f"w{i}"], data[f"b{i}"]) for i in range(self.meta["n_layers"])]
        self.status_head = (data["ws"], data["bs"])
        self.cause_head = (data["wc"], data["bc"])
        self.temperature = float(self.meta.get("temperature", 1.0))
        self.cause_threshold = float(self.meta.get("cause_threshold", 0.5))
        self.version = self.meta["version"]

    def _trunk(self, x: np.ndarray) -> np.ndarray:
        h = (x - self.mean) / self.std
        for w, b in self.layers:
            h = np.maximum(h @ w.T + b, 0.0)
        return h

    def predict_proba(self, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        x = np.atleast_2d(np.asarray(x, dtype=np.float32))
        h = self._trunk(x)
        logits = (h @ self.status_head[0].T + self.status_head[1]) / self.temperature
        logits -= logits.max(axis=1, keepdims=True)
        p = np.exp(logits)
        p /= p.sum(axis=1, keepdims=True)
        z = np.clip(h @ self.cause_head[0].T + self.cause_head[1], -30.0, 30.0)
        c = 1.0 / (1.0 + np.exp(-z))
        return p, c

    def top_causes(self, features: np.ndarray, n: int) -> list[dict]:
        _, c = self.predict_proba(features)
        order = np.argsort(-c[0])[:n]
        return [{"id": CAUSES[i], "label": CAUSE_TITLES[CAUSES[i]], "prob": round(float(c[0][i]), 3)} for i in order]

    def predict(self, features: np.ndarray) -> dict:
        p, c = self.predict_proba(features)
        p, c = p[0], c[0]
        status = int(p.argmax())
        causes = [
            {"id": cid, "label": CAUSE_TITLES[cid], "prob": round(float(c[i]), 3)}
            for i, cid in enumerate(CAUSES) if c[i] >= self.cause_threshold
        ]
        causes.sort(key=lambda d: -d["prob"])
        return {
            "status_code": status,
            "status": STATUS_LABELS[status],
            "status_title": STATUS_TITLES[status],
            "confidence": round(float(p[status]), 3),
            "probabilities": {k: round(float(v), 3) for k, v in zip(STATUS_LABELS, p)},
            "causes": causes,
            "fan_level": fan_policy(status, [d["id"] for d in causes]),
            "model_version": self.version,
        }
