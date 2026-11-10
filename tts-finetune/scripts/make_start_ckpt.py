"""Build the warm-start checkpoint for the NELVIN fine-tune.

Piper numbers speakers by first appearance in the CSV, so NELVIN becomes speaker 0.
We copy twi-6's speaker vector (id 29, male, best pure-Twi voice) into row 0 so
NELVIN starts from a close voice instead of whoever speaker 0 happened to be.
The table keeps all 1555 rows, so the checkpoint loads without resizing.
Optimizer state is dropped: Piper's warmstart starts a fresh optimizer anyway.
"""
import argparse

import torch

EMB_G = "model_g.emb_g.weight"

ap = argparse.ArgumentParser()
ap.add_argument("--ckpt", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--seed-speaker", type=int, default=29)  # twi-6
args = ap.parse_args()

ckpt = torch.load(args.ckpt, map_location="cpu", weights_only=False)
sd = ckpt["state_dict"]
print("emb_g", tuple(sd[EMB_G].shape))
sd[EMB_G][0] = sd[EMB_G][args.seed_speaker].clone()
hp = ckpt.get("hyper_parameters", {})
print({k: hp[k] for k in sorted(hp) if not isinstance(hp[k], (dict, list)) or k in ("upsample_rates",)})
torch.save({"state_dict": sd, "hyper_parameters": hp}, args.out)
print("wrote", args.out)
