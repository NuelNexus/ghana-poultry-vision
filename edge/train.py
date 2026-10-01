"""Train the PoultryGrid v2 coop-condition model and export it for the Pi.

    pip install -r requirements-train.txt
    python train.py                  # writes models/poultrygrid_v2.npz + metrics.json

Also trains the original AI_For_Poultry network (5 raw inputs -> 16 -> 16 -> 3)
on the same data so the improvement is measured, not claimed.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, recall_score

from poultrygrid import MODEL_VERSION
from poultrygrid.features import CAUSES, FEATURE_NAMES, STATUS_TITLES
from poultrygrid.model_np import CoopModel
from poultrygrid.simulator import build_dataset

HERE = Path(__file__).parent


class CoopNet(nn.Module):
    def __init__(self, n_in: int, hidden=(64, 64, 32)):
        super().__init__()
        layers, prev = [], n_in
        for h in hidden:
            layers += [nn.Linear(prev, h), nn.ReLU(), nn.Dropout(0.1)]
            prev = h
        self.trunk = nn.Sequential(*layers)
        self.status = nn.Linear(prev, 3)
        self.causes = nn.Linear(prev, len(CAUSES))

    def forward(self, x):
        h = self.trunk(x)
        return self.status(h), self.causes(h)


class OriginalNet(nn.Module):
    """The model from engieworks15-dotcom/AI_For_Poultry, unchanged."""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(5, 16), nn.ReLU(), nn.Linear(16, 16), nn.ReLU(), nn.Linear(16, 3))

    def forward(self, x):
        return self.net(x)


def split_by_episode(eps, seed):
    rng = np.random.default_rng(seed)
    ids = rng.permutation(np.unique(eps))
    n = len(ids)
    train_ids, val_ids = set(ids[: int(n * 0.7)]), set(ids[int(n * 0.7): int(n * 0.85)])
    tr = np.array([e in train_ids for e in eps])
    va = np.array([e in val_ids for e in eps])
    return tr, va, ~(tr | va)


def train_v2(X, ys, yc, tr, va, epochs, seed):
    torch.manual_seed(seed)
    mean, std = X[tr].mean(0), X[tr].std(0) + 1e-6
    norm = lambda a: torch.tensor((a - mean) / std, dtype=torch.float32)
    Xtr, Xva = norm(X[tr]), norm(X[va])
    ytr, yva = torch.tensor(ys[tr]), torch.tensor(ys[va])
    ctr, cva = torch.tensor(yc[tr]), torch.tensor(yc[va])

    model = CoopNet(X.shape[1])
    counts = np.bincount(ys[tr], minlength=3)
    # Missing a critical event is worse than a false alarm.
    class_w = torch.tensor(counts.sum() / (3 * counts) * np.array([1.0, 1.0, 1.4]), dtype=torch.float32)
    ce = nn.CrossEntropyLoss(weight=class_w)
    pos = ctr.mean(0).clamp(min=1e-3)
    bce = nn.BCEWithLogitsLoss(pos_weight=((1 - pos) / pos).clamp(max=10.0))
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)

    best, best_state, patience = 1e9, None, 0
    for epoch in range(epochs):
        model.train()
        perm = torch.randperm(len(Xtr))
        for i in range(0, len(perm), 512):
            idx = perm[i:i + 512]
            ls, lc = model(Xtr[idx])
            loss = ce(ls, ytr[idx]) + 0.5 * bce(lc, ctr[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
        sched.step()
        model.eval()
        with torch.no_grad():
            ls, lc = model(Xva)
            vloss = (ce(ls, yva) + 0.5 * bce(lc, cva)).item()
        if vloss < best - 1e-4:
            best, best_state, patience = vloss, {k: v.clone() for k, v in model.state_dict().items()}, 0
        else:
            patience += 1
            if patience >= 8:
                break
    model.load_state_dict(best_state)
    model.eval()

    # Temperature scaling so the confidence shown in the app means something.
    with torch.no_grad():
        logits, _ = model(Xva)
    t = torch.ones(1, requires_grad=True)
    topt = torch.optim.LBFGS([t], lr=0.05, max_iter=100)

    def closure():
        topt.zero_grad()
        l = nn.functional.cross_entropy(logits / t, yva)
        l.backward()
        return l

    topt.step(closure)
    return model, mean, std, float(t.detach().clamp(0.5, 5.0)), epoch + 1


def train_original(raw, ys, tr, seed):
    torch.manual_seed(seed)
    mean, std = raw[tr].mean(0), raw[tr].std(0) + 1e-6
    Xtr = torch.tensor((raw[tr] - mean) / std, dtype=torch.float32)
    ytr = torch.tensor(ys[tr])
    model = OriginalNet()
    opt = torch.optim.Adam(model.parameters(), lr=0.01)
    ce = nn.CrossEntropyLoss()
    for _ in range(50):
        perm = torch.randperm(len(Xtr))
        for i in range(0, len(perm), 256):
            idx = perm[i:i + 256]
            opt.zero_grad()
            ce(model(Xtr[idx]), ytr[idx]).backward()
            opt.step()
    model.eval()
    return lambda a: model(torch.tensor((a - mean) / std, dtype=torch.float32)).argmax(1).numpy()


def export_npz(model: CoopNet, mean, std, temperature, path: Path):
    linears = [m for m in model.trunk if isinstance(m, nn.Linear)]
    arrays = {f"w{i}": l.weight.detach().numpy() for i, l in enumerate(linears)}
    arrays.update({f"b{i}": l.bias.detach().numpy() for i, l in enumerate(linears)})
    arrays.update(
        ws=model.status.weight.detach().numpy(), bs=model.status.bias.detach().numpy(),
        wc=model.causes.weight.detach().numpy(), bc=model.causes.bias.detach().numpy(),
        mean=mean.astype(np.float32), std=std.astype(np.float32),
    )
    meta = {
        "version": MODEL_VERSION, "n_layers": len(linears), "features": FEATURE_NAMES,
        "causes": CAUSES, "temperature": temperature, "cause_threshold": 0.5,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    np.savez_compressed(path, meta=json.dumps(meta), **arrays)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes", type=int, default=3000)
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=HERE / "models")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    print(f"Simulating {args.episodes} coop episodes...")
    X, ys, yc, raw, eps = build_dataset(args.episodes, args.seed)
    tr, va, te = split_by_episode(eps, args.seed)
    print(f"{len(X)} samples  train={tr.sum()} val={va.sum()} test={te.sum()}  (split by episode, no leakage)")

    model, mean, std, temperature, epochs = train_v2(X, ys, yc, tr, va, args.epochs, args.seed)
    path = args.out / "poultrygrid_v2.npz"
    export_npz(model, mean, std, temperature, path)

    # Evaluate the exported numpy model, i.e. exactly what runs on the Pi.
    np_model = CoopModel(path)
    p, c = np_model.predict_proba(X[te])
    pred = p.argmax(1)
    cause_pred = (c >= np_model.cause_threshold).astype(int)
    with torch.no_grad():
        tp, _ = model(torch.tensor((X[te] - mean) / std, dtype=torch.float32))
    assert (tp.argmax(1).numpy() == pred).mean() > 0.999, "numpy export disagrees with torch"

    base_pred = train_original(raw, ys, tr, args.seed)(raw[te])

    def summary(y, yhat):
        return {
            "accuracy": round(accuracy_score(y, yhat), 4),
            "macro_f1": round(f1_score(y, yhat, average="macro"), 4),
            "critical_recall": round(recall_score(y, yhat, labels=[2], average="macro"), 4),
            "confusion_matrix": confusion_matrix(y, yhat).tolist(),
        }

    metrics = {
        "model_version": MODEL_VERSION,
        "test_samples": int(te.sum()),
        "epochs_trained": epochs,
        "temperature": round(temperature, 3),
        "status_labels": STATUS_TITLES,
        "v2": summary(ys[te], pred),
        "original_ai_for_poultry_on_same_data": summary(ys[te], base_pred),
        "cause_f1": {cid: round(f1_score(yc[te][:, i], cause_pred[:, i], zero_division=0), 4)
                     for i, cid in enumerate(CAUSES)},
    }
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2))

    v2, base = metrics["v2"], metrics["original_ai_for_poultry_on_same_data"]
    print(f"\n{'':28}{'v2':>10}{'original':>10}")
    for k in ("accuracy", "macro_f1", "critical_recall"):
        print(f"{k:28}{v2[k] * 100:9.2f}%{base[k] * 100:9.2f}%")
    print("\nCause F1:", json.dumps(metrics["cause_f1"]))
    print(f"\nSaved {path} ({path.stat().st_size / 1024:.1f} KB) and metrics.json")


if __name__ == "__main__":
    main()
