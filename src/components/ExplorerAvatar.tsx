import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type * as THREE_NS from "three";
import { AVATAR_ACTIONS, type AvatarAction } from "@/lib/avatar-actions";

// The female explorer (VRoid-style "J_Bip_*" skeleton) driven by Mixamo clips
// ("mixamorig*" skeleton). The clips play on a hidden Mixamo rig; every frame
// each bone's rotation, relative to its rest pose, is copied onto the matching
// explorer bone in world space, so the two rigs don't need the same bone axes.

export interface ExplorerAvatarHandle {
  /** Switch animation. `then` plays when a one-shot move (backflip) ends. */
  play: (action: AvatarAction, then?: AvatarAction) => void;
}

const MODEL_URL = "/ai/explorer.fbx";
const ONE_SHOT: AvatarAction[] = ["backflip"];

// Every clip she can play. The Mixamo FBX files carry one clip each; the two
// .glb files are three.js's example Mixamo rigs (Xbot, Soldier), stripped to
// skeleton + animation, which add more idles.
type ClipSource = { id: string; url: string; clip?: string; once?: boolean };
const CLIPS: ClipSource[] = [
  ...(Object.keys(AVATAR_ACTIONS) as AvatarAction[]).map((id) => ({
    id,
    url: `/ai/anims/${AVATAR_ACTIONS[id].file}`,
    once: ONE_SHOT.includes(id),
  })),
  { id: "idle:xbot", url: "/ai/anims/xbot.glb", clip: "idle" },
  { id: "idle:soldier", url: "/ai/anims/soldier.glb", clip: "Idle" },
  { id: "idle:agree", url: "/ai/anims/xbot.glb", clip: "agree" },
  { id: "idle:headshake", url: "/ai/anims/xbot.glb", clip: "headShake" },
];
// She rotates through these while nobody is talking.
const IDLE_POOL = ["idle", "idle:xbot", "idle:soldier", "idle:agree", "idle:headshake"];

const SIDES = { L: "Left", R: "Right" } as const;
const BONE_MAP: Record<string, string> = {
  J_Bip_C_Hips: "Hips",
  J_Bip_C_Spine: "Spine",
  J_Bip_C_Chest: "Spine1",
  J_Bip_C_UpperChest: "Spine2",
  J_Bip_C_Neck: "Neck",
  J_Bip_C_Head: "Head",
};
for (const [s, side] of Object.entries(SIDES)) {
  Object.assign(BONE_MAP, {
    [`J_Bip_${s}_Shoulder`]: `${side}Shoulder`,
    [`J_Bip_${s}_UpperArm`]: `${side}Arm`,
    [`J_Bip_${s}_LowerArm`]: `${side}ForeArm`,
    [`J_Bip_${s}_Hand`]: `${side}Hand`,
    [`J_Bip_${s}_UpperLeg`]: `${side}UpLeg`,
    [`J_Bip_${s}_LowerLeg`]: `${side}Leg`,
    [`J_Bip_${s}_Foot`]: `${side}Foot`,
    [`J_Bip_${s}_ToeBase`]: `${side}ToeBase`,
  });
  for (const [vroid, mixamo] of [
    ["Thumb", "Thumb"],
    ["Index", "Index"],
    ["Middle", "Middle"],
    ["Ring", "Ring"],
    ["Little", "Pinky"],
  ]) {
    for (const i of [1, 2, 3]) BONE_MAP[`J_Bip_${s}_${vroid}${i}`] = `${side}Hand${mixamo}${i}`;
  }
}

// The set: tiled grass under her and the chicken coop behind, fading into a
// sky-coloured fog. Sizes are in units of her height `h` (her feet are at y=0).
async function loadSet(
  THREE: typeof THREE_NS,
  scene: THREE_NS.Scene,
  h: number,
  isDisposed: () => boolean,
) {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
  if (isDisposed()) return;
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [grass, coop] = await Promise.all([
    gltf.loadAsync(GRASS_URL).catch(() => null),
    gltf.loadAsync(COOP_URL).catch(() => null),
  ]);
  // Unmounted while loading: free what arrived and add nothing to the scene.
  if (isDisposed()) {
    if (grass) disposeObject(grass.scene);
    if (coop) disposeObject(coop.scene);
    return;
  }

  scene.fog = new THREE.Fog(SKY, h * 4.5, h * 13);

  // Soft contact shadow so she stands on the ground instead of floating.
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(h * 0.7, h * 0.45),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = h * 0.004;
  shadow.renderOrder = 1;
  scene.add(shadow);

  // Distant ground that the fog swallows, so the grass never ends at an edge.
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(h * 60, h * 60),
    new THREE.MeshLambertMaterial({ color: 0x5f7f2e }),
  );
  far.rotation.x = -Math.PI / 2;
  far.position.y = -h * 0.08;
  scene.add(far);

  if (grass) {
    const patch = grass.scene;
    // Drop the SketchUp edge outlines that come with this model.
    const lines: THREE_NS.Object3D[] = [];
    patch.traverse((o) => {
      if ((o as THREE_NS.LineSegments).isLine) lines.push(o);
      const m = o as THREE_NS.Mesh;
      if (m.isMesh) {
        const mat = m.material as THREE_NS.MeshStandardMaterial;
        if (mat.transparent) {
          // Cut-out blades sort better than blended ones. Mipmaps would
          // average the blade alpha away at a distance, so skip them.
          mat.transparent = false;
          mat.depthWrite = true;
          mat.alphaTest = 0.35;
          if (mat.map) {
            mat.map.generateMipmaps = false;
            mat.map.minFilter = THREE.LinearFilter;
            mat.map.needsUpdate = true;
          }
        }
        mat.side = THREE.DoubleSide;
      }
    });
    lines.forEach((l) => l.removeFromParent());
    patch.scale.setScalar(h * 0.038);
    patch.updateMatrixWorld(true);
    // Tile by the ground square (the blades overhang it), with its top at y=0.
    let ground: THREE_NS.Object3D | undefined;
    patch.traverse((o) => {
      const m = o as THREE_NS.Mesh;
      if (m.isMesh && !(m.material as THREE_NS.Material).alphaTest) ground = m;
    });
    const b = new THREE.Box3().setFromObject(ground ?? patch);
    const w = b.max.x - b.min.x;
    const d = b.max.z - b.min.z;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    for (const ix of [-1, 0, 1]) {
      for (const iz of [-2, -1, 0]) {
        const tile = ix === 0 && iz === 0 ? patch : patch.clone();
        tile.position.set(ix * w - cx, -b.max.y, iz * d - cz + d * 0.3);
        scene.add(tile);
      }
    }
  }

  if (coop) {
    const m = coop.scene;
    const b0 = new THREE.Box3().setFromObject(m);
    m.scale.setScalar((h * 1.55) / (b0.max.y - b0.min.y));
    m.rotation.y = COOP_TURN;
    m.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(m);
    m.position.set(
      -(b.min.x + b.max.x) / 2 - h * 0.35,
      -b.min.y,
      -h * 3.2 - (b.min.z + b.max.z) / 2,
    );
    scene.add(m);
  }
}

const GRASS_URL = "/ai/grass.glb";
const COOP_URL = "/ai/coop.glb";
const COOP_TURN = Math.PI / 2;
const SKY = 0xd9f1fb;

/** Free the GPU resources (geometries, materials, textures) under `root`. */
function disposeObject(root: THREE_NS.Object3D) {
  root.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats as THREE_NS.MeshPhongMaterial[]) {
      mat.map?.dispose();
      mat.dispose();
    }
  });
}

/**
 * The 3D guide. `active={false}` pauses the render loop (no requestAnimationFrame)
 * while keeping the scene loaded, e.g. while the voice stage is hidden. The loop
 * also pauses on its own while the canvas is off screen or display:none.
 */
export function ExplorerAvatar({
  ref,
  className,
  active = true,
}: {
  ref?: Ref<ExplorerAvatarHandle>;
  className?: string;
  /** false = pause rendering (default true). */
  active?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<ExplorerAvatarHandle["play"]>(() => {});
  // Set by the scene once it can render; called whenever `active` or visibility changes.
  const syncLoopRef = useRef<() => void>(() => {});
  const activeRef = useRef(active);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({ play: (a, then) => playRef.current(a, then) }), []);

  useEffect(() => {
    activeRef.current = active;
    syncLoopRef.current();
  }, [active]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let raf = 0;
    // Every resource registers its own release as soon as it exists, so an
    // unmount at any point (mid-load, after a load error) frees all of it.
    const disposers: (() => void)[] = [];
    const onDispose = (fn: () => void) => {
      if (disposed) fn();
      else disposers.push(fn);
    };
    const isDisposed = () => disposed;

    (async () => {
      const THREE = await import("three");
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      onDispose(() => {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      // Runs before the renderer disposer (registered first, run last).
      onDispose(() => disposeObject(scene));
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 2.2));
      const key = new THREE.DirectionalLight(0xffffff, 2);
      key.position.set(1.5, 3, 2.5);
      scene.add(key);

      const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
      const controls = new OrbitControls(camera, renderer.domElement);
      onDispose(() => controls.dispose());
      controls.enablePan = false;
      controls.enableDamping = true;

      const resize = () => {
        const w = mount.clientWidth || 1;
        const h = mount.clientHeight || 1;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      onDispose(() => ro.disconnect());
      ro.observe(mount);
      resize();

      const loader = new FBXLoader();
      const load = (url: string, onProgress?: (p: number) => void) =>
        new Promise<THREE_NS.Group>((res, rej) =>
          loader.load(url, res, (e) => e.total && onProgress?.(e.loaded / e.total), rej),
        );

      let model: THREE_NS.Group;
      try {
        model = await load(MODEL_URL, (p) => {
          if (!disposed) setProgress(p);
        });
      } catch (e) {
        if (!disposed) setError(`Could not load the 3D model (${String(e)})`);
        return;
      }
      if (disposed) {
        disposeObject(model);
        return;
      }
      model.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        if (m.isMesh) {
          m.frustumCulled = false;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats as THREE_NS.MeshPhongMaterial[]) {
            if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
            if ("shininess" in mat) mat.shininess = 5;
          }
        }
      });
      scene.add(model);
      model.updateMatrixWorld(true);
      // The Tripo export is Z-up: stand her up (Y-up) if she's lying down.
      const raw = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      if (raw.z > raw.y * 1.5) {
        model.rotation.x = -Math.PI / 2;
        model.updateMatrixWorld(true);
      }

      // Frame the character.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const target = new THREE.Vector3(center.x, box.min.y + size.y * 0.55, center.z);
      camera.position.set(center.x, target.y, center.z + size.y * 2.1);
      camera.near = size.y / 100;
      camera.far = size.y * 50;
      camera.updateProjectionMatrix();
      controls.target.copy(target);
      controls.minDistance = size.y * 0.8;
      controls.maxDistance = size.y * 4;
      controls.maxPolarAngle = Math.PI / 2 - 0.08; // stay above the grass
      void loadSet(THREE, scene, size.y, isDisposed).catch(() => {
        /* the set is decoration: she still works without it */
      });

      // Target bones, parent-first, with their original rest pose so each
      // source rig can be aligned from the same starting point.
      const targetBones: THREE_NS.Bone[] = [];
      model.traverse((o) => {
        if ((o as THREE_NS.Bone).isBone && BONE_MAP[o.name]) targetBones.push(o as THREE_NS.Bone);
      });
      const original = targetBones.map((b) => ({
        b,
        q: b.quaternion.clone(),
        p: b.position.clone(),
      }));
      const restoreTarget = () => {
        for (const o of original) {
          o.b.quaternion.copy(o.q);
          o.b.position.copy(o.p);
        }
        model.updateMatrixWorld(true);
      };

      // Load every clip file once (several clips can share a file).
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
      const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const urls = [...new Set(CLIPS.map((c) => c.url))];
      const files = new Map<string, { root: THREE_NS.Object3D; clips: THREE_NS.AnimationClip[] }>();
      await Promise.all(
        urls.map(async (url) => {
          try {
            if (url.endsWith(".glb")) {
              const g = await gltfLoader.loadAsync(url);
              files.set(url, { root: g.scene, clips: g.animations });
            } else {
              const g = await load(url);
              files.set(url, { root: g, clips: g.animations });
            }
          } catch {
            /* a missing clip file just means fewer moves */
          }
        }),
      );
      if (disposed) {
        files.forEach((f) => disposeObject(f.root));
        return;
      }
      if (!files.size) {
        setError("Could not load the animations");
        return;
      }

      // Each file's skeleton becomes a hidden source rig.
      type Pair = {
        tgt: THREE_NS.Bone;
        src: THREE_NS.Object3D;
        srcRestInv: THREE_NS.Quaternion;
        tgtRest: THREE_NS.Quaternion;
      };
      type Rig = {
        root: THREE_NS.Object3D;
        mixer: THREE_NS.AnimationMixer;
        pairs: Pair[];
        hips?: Pair;
        srcHipsRest?: THREE_NS.Vector3;
        tgtHipsRest?: THREE_NS.Vector3;
        hipScale: number;
      };
      const wp = (o: THREE_NS.Object3D) => o.getWorldPosition(new THREE.Vector3());
      const pickChild = (b: THREE_NS.Object3D) => {
        const kids = b.children.filter((c) => BONE_MAP[c.name]);
        return kids.find((c) => /Spine|Chest|Neck|Head|Middle1/.test(c.name)) ?? kids[0];
      };
      const buildRig = (root: THREE_NS.Object3D): Rig | null => {
        root.visible = false;
        scene.add(root);
        root.updateMatrixWorld(true);
        const srcByName = new Map<string, THREE_NS.Object3D>();
        root.traverse((o) => {
          const m = o.name.match(/^mixamorig\d*:?(.+)$/);
          if (m && !srcByName.has(m[1])) srcByName.set(m[1], o);
        });
        const l = srcByName.get("LeftUpLeg");
        const r = srcByName.get("RightUpLeg");
        if (!l || !r || !srcByName.get("Hips")) return null;
        // Turn the rig to face +Z like her (its left hip on +X).
        const side = wp(l).sub(wp(r));
        root.rotation.y -= Math.atan2(-side.z, side.x);
        root.updateMatrixWorld(true);

        // Her rest pose has arms down; Mixamo rigs rest in a T-pose. Bend each
        // of her bones (parent first) to point the same way as its twin, so
        // both share one rest pose before rotations are copied.
        restoreTarget();
        for (const tgt of targetBones) {
          if (tgt.name === "J_Bip_C_Hips") continue;
          const tChild = pickChild(tgt);
          const src = srcByName.get(BONE_MAP[tgt.name]);
          const sChild = tChild && srcByName.get(BONE_MAP[tChild.name]);
          if (!tChild || !src || !sChild) continue;
          const tDir = wp(tChild).sub(wp(tgt)).normalize();
          const sDir = wp(sChild).sub(wp(src)).normalize();
          const fix = new THREE.Quaternion().setFromUnitVectors(tDir, sDir);
          const world = fix.multiply(tgt.getWorldQuaternion(new THREE.Quaternion()));
          const parentWorld = tgt.parent!.getWorldQuaternion(new THREE.Quaternion());
          tgt.quaternion.copy(parentWorld.invert().multiply(world));
          tgt.updateMatrixWorld(true);
        }
        const pairs: Pair[] = [];
        for (const tgt of targetBones) {
          const src = srcByName.get(BONE_MAP[tgt.name]);
          if (!src) continue;
          pairs.push({
            tgt,
            src,
            srcRestInv: src.getWorldQuaternion(new THREE.Quaternion()).invert(),
            tgtRest: tgt.getWorldQuaternion(new THREE.Quaternion()),
          });
        }
        const hips = pairs.find((p) => p.tgt.name === "J_Bip_C_Hips");
        const srcHipsRest = hips && wp(hips.src);
        const tgtHipsRest = hips && wp(hips.tgt);
        restoreTarget();
        // The rigs have no mesh, so find the floor from the lowest bone.
        let floor = Infinity;
        srcByName.forEach((o) => (floor = Math.min(floor, wp(o).y)));
        const hipScale =
          srcHipsRest && tgtHipsRest
            ? (tgtHipsRest.y - box.min.y) / Math.max(1e-6, srcHipsRest.y - floor)
            : 1;
        const mixer = new THREE.AnimationMixer(root);
        onDispose(() => mixer.stopAllAction());
        return { root, mixer, pairs, hips, srcHipsRest, tgtHipsRest, hipScale };
      };

      const rigs = new Map<string, Rig>();
      files.forEach((f, url) => {
        const rig = buildRig(f.root);
        if (rig) rigs.set(url, rig);
        else disposeObject(f.root);
      });

      // id -> the rig that plays it and its action.
      const actions = new Map<string, { rig: Rig; action: THREE_NS.AnimationAction }>();
      for (const c of CLIPS) {
        const rig = rigs.get(c.url);
        const f = files.get(c.url);
        const clip = c.clip ? f?.clips.find((k) => k.name === c.clip) : f?.clips[0];
        if (!rig || !clip) continue;
        const action = rig.mixer.clipAction(clip);
        if (c.once) {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actions.set(c.id, { rig, action });
      }
      const idles = IDLE_POOL.filter((id) => actions.has(id));

      // Switching moves blends from her current pose over FADE seconds, which
      // also works between clips that live on different rigs.
      const FADE = 0.4;
      let current: { rig: Rig; action: THREE_NS.AnimationAction } | null = null;
      let currentId = "";
      let after: AvatarAction = "idle";
      let fade = 1;
      const fromQ = new Map<THREE_NS.Bone, THREE_NS.Quaternion>();
      const fromHips = new THREE.Vector3();
      let idling = false;
      let idleLeft = 0;

      const start = (id: string) => {
        const next = actions.get(id);
        if (!next || id === currentId) return;
        for (const b of targetBones) fromQ.set(b, b.quaternion.clone());
        const hipsBone = targetBones.find((b) => b.name === "J_Bip_C_Hips");
        if (hipsBone) fromHips.copy(hipsBone.position);
        fade = current ? 0 : 1;
        if (current) current.action.stop();
        next.action.reset().setEffectiveWeight(1).play();
        current = next;
        currentId = id;
      };
      // Several idles: pick one she isn't already doing, hold it for a while.
      const nextIdle = () => {
        const pool = idles.filter((id) => id !== currentId);
        const id = pool.length ? pool[Math.floor(Math.random() * pool.length)] : idles[0];
        if (!id) return;
        start(id);
        const len = actions.get(id)!.action.getClip().duration;
        idleLeft = Math.min(16, Math.max(7, len * (1 + Math.floor(Math.random() * 2))));
      };
      const play = (id: AvatarAction, then: AvatarAction = "idle") => {
        after = then;
        if (id === "idle") {
          if (!idling) {
            idling = true;
            nextIdle();
          }
          return;
        }
        idling = false;
        start(actions.has(id) ? id : actions.has("talking") ? "talking" : (idles[0] ?? ""));
      };
      // One-shot moves (backflip) hand back to whatever should follow them.
      rigs.forEach((rig) => rig.mixer.addEventListener("finished", () => play(after)));
      playRef.current = play;
      play("idle");
      setReady(true);

      const qWorld = new Map<THREE_NS.Object3D, THREE_NS.Quaternion>();
      const tmpQ = new THREE.Quaternion();
      const parentQ = new THREE.Quaternion();
      const tmpV = new THREE.Vector3();
      const parentInv = new THREE.Matrix4();

      const retarget = (dt: number) => {
        if (!current) return;
        const rig = current.rig;
        rig.root.updateMatrixWorld(true);
        qWorld.clear();
        for (const p of rig.pairs) {
          // World-space rotation of the source bone relative to its rest pose...
          p.src.getWorldQuaternion(tmpQ).multiply(p.srcRestInv);
          // ...applied on top of the target bone's own rest pose.
          const world = tmpQ.clone().multiply(p.tgtRest);
          qWorld.set(p.tgt, world);
          const parent = p.tgt.parent!;
          const pw = qWorld.get(parent) ?? parent.getWorldQuaternion(parentQ);
          p.tgt.quaternion.copy(pw).invert().multiply(world);
        }
        // Hips: keep vertical motion (crouch, jump, flip), drop travel so she stays in place.
        if (rig.hips && rig.srcHipsRest && rig.tgtHipsRest) {
          rig.hips.src.getWorldPosition(tmpV);
          const worldPos = rig.tgtHipsRest.clone();
          worldPos.y += (tmpV.y - rig.srcHipsRest.y) * rig.hipScale;
          parentInv.copy(rig.hips.tgt.parent!.matrixWorld).invert();
          rig.hips.tgt.position.copy(worldPos.applyMatrix4(parentInv));
        }
        if (fade < 1) {
          fade = Math.min(1, fade + dt / FADE);
          const t = fade * fade * (3 - 2 * fade);
          for (const p of rig.pairs) {
            const from = fromQ.get(p.tgt);
            if (from) p.tgt.quaternion.slerpQuaternions(from, p.tgt.quaternion.clone(), t);
          }
          if (rig.hips) {
            const hp = rig.hips.tgt.position;
            hp.lerpVectors(fromHips, hp.clone(), t);
          }
        }
      };

      const clock = new THREE.Clock();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.1);
        current?.rig.mixer.update(dt);
        if (idling && (idleLeft -= dt) <= 0) nextIdle();
        retarget(dt);
        controls.update();
        renderer.render(scene, camera);
      };

      // Run the loop only while active and on screen (display:none counts as off).
      let visible = true;
      const syncLoop = () => {
        const run = !disposed && activeRef.current && visible;
        if (run && !raf) {
          clock.getDelta(); // don't fast-forward over the paused time
          tick();
        } else if (!run && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      };
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        syncLoop();
      });
      onDispose(() => io.disconnect());
      io.observe(mount);
      syncLoopRef.current = syncLoop;
      syncLoop();
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      playRef.current = () => {};
      syncLoopRef.current = () => {};
      // Release in reverse order of creation (renderer last).
      for (const fn of disposers.reverse()) {
        try {
          fn();
        } catch {
          /* keep releasing the rest */
        }
      }
      disposers.length = 0;
    };
  }, []);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-ink-2">
          {error ?? (
            <>
              <span className="tabular-nums">Loading Ama… {Math.round(progress * 100)}%</span>
              <div className="h-1 w-40 overflow-hidden rounded-full bg-hairline">
                <div
                  className="h-full bg-brand transition-[width]"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
