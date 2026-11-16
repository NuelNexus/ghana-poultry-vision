import { createServerFn } from "@tanstack/react-start";
import { query } from "../db.server";
import { requireUser } from "./middleware";

// Camera vision results for the Cameras page: what the YOLO11n worker
// (edge/vision.py, on the Pi or a PC) last saw on each of this account's
// cameras, the annotated frame, and the last day's events.

export interface CameraVision {
  camera_id: string;
  analysed_at: string;
  birds: number;
  inactive: number;
  /** Share of tracked birds that moved recently, 0..1; null while warming up. */
  activity: number | null;
  pests: { label: string; confidence: number }[];
  /** data: URL of the annotated JPEG, or null. */
  frame: string | null;
  worker: string | null;
}

export interface VisionEvent {
  id: number;
  camera_id: string;
  kind: "pest" | "inactive" | "low_activity";
  label: string;
  detail: string | null;
  created_at: string;
}

export const getCameraVision = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const [latest, events] = await Promise.all([
      query<Omit<CameraVision, "frame"> & { frame_b64: string | null }>(
        `select v.camera_id, v.analysed_at, v.birds, v.inactive, v.activity, v.pests, v.worker,
                encode(v.frame, 'base64') as frame_b64
           from camera_vision v join cameras c on c.id = v.camera_id
          where c.owner_id = $1`,
        [context.user.id],
      ),
      query<VisionEvent>(
        `select e.id::int as id, e.camera_id, e.kind, e.label, e.detail, e.created_at
           from vision_events e join cameras c on c.id = e.camera_id
          where c.owner_id = $1 and e.created_at > now() - interval '24 hours'
          order by e.created_at desc limit 50`,
        [context.user.id],
      ),
    ]);
    return {
      latest: latest.map(({ frame_b64, ...v }): CameraVision => ({
        ...v,
        // Postgres wraps base64 every 76 characters.
        frame: frame_b64 ? `data:image/jpeg;base64,${frame_b64.replace(/\s/g, "")}` : null,
      })),
      events,
    };
  });
