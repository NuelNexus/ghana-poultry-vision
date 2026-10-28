import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, queryOne } from "../db.server";
import { requireManager, requireUser } from "./middleware";
import { FRESHNESS_MS } from "./types";
import type {
  AiMonitor,
  AiSnapshot,
  DashboardStats,
  Alert,
  Camera,
  Device,
  Farm,
  Hatchery,
  House,
  Reading,
} from "./types";

// Data access for the dashboard pages, backed by Neon.
//
// Every account is its own farm: it only sees the farms it owns, the devices
// and cameras it registered, and the houses, readings, alerts and hatchery
// batches that hang off those. The fragments below take the placeholder that
// holds the signed-in user's id (e.g. "$1").

const myFarms = (u: string) => `(select id from farms where owner_id = ${u})`;
const myDevices = (u: string) => `(select id from devices where owner_id = ${u})`;
const myAlert = (u: string) =>
  `(alerts.farm_id in ${myFarms(u)} or alerts.device_id in ${myDevices(u)})`;

/** The account's farm: the one it names (if it owns it), else its first, else a new one. */
async function ensureFarm(farmId: string | undefined, ownerId: string) {
  if (farmId) {
    const own = await queryOne<{ id: string }>(
      "select id from farms where id = $1 and owner_id = $2",
      [farmId, ownerId],
    );
    if (!own) throw new Error("Farm not found");
    return own.id;
  }
  const existing = await queryOne<{ id: string }>(
    "select id from farms where owner_id = $1 order by created_at limit 1",
    [ownerId],
  );
  if (existing) return existing.id;
  const f = await queryOne<{ id: string }>(
    "insert into farms (name, owner_id) values ('My Farm', $1) returning id",
    [ownerId],
  );
  return f!.id;
}

/** Farm of a house the account owns; throws for anyone else's house. */
async function ownHouseFarm(houseId: string | null | undefined, userId: string) {
  if (!houseId) return null;
  const h = await queryOne<{ farm_id: string }>(
    `select farm_id from poultry_houses where id = $1 and farm_id in ${myFarms("$2")}`,
    [houseId, userId],
  );
  if (!h) throw new Error("House not found");
  return h.farm_id;
}

// Latest AI reading per device the account owns, most recently reporting first. $1 = user id.
const LATEST_AI_SQL = `
  select * from (
    select distinct on (r.device_id) r.*, d.device_id as device_code, d.last_seen, h.name as house_name
      from sensor_readings r
      join devices d on d.id = r.device_id
      left join poultry_houses h on h.id = r.house_id
     where r.ai_status is not null and d.owner_id = $1
     order by r.device_id, r.created_at desc
  ) latest
  order by created_at desc`;

// Optional window for list endpoints. Without it, the old row caps apply.
const windowInput = z.object({ days: z.number().int().min(1).max(366).optional() }).optional();

// Dashboard -------------------------------------------------------------

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const u = context.user.id;
    const [counts, history, recentAlerts, ai] = await Promise.all([
      queryOne<{
        total_birds: number;
        farms: number;
        temperature: number | null;
        humidity: number | null;
        active_alerts: number;
        open_critical: number;
        eggs: number;
        hatched: number;
        last_reading_at: string | null;
      }>(
        `select
            (select coalesce(sum(bird_count), 0)::int from poultry_houses where farm_id in ${myFarms("$1")}) as total_birds,
            (select count(*)::int from farms where owner_id = $1) as farms,
            (select round(avg(temperature), 1) from (select temperature from sensor_readings where device_id in ${myDevices("$1")} order by created_at desc limit 20) t) as temperature,
            (select round(avg(humidity), 1) from (select humidity from sensor_readings where device_id in ${myDevices("$1")} order by created_at desc limit 20) t) as humidity,
            (select count(*)::int from alerts where not coalesce(resolved, false) and ${myAlert("$1")}) as active_alerts,
            (select count(*)::int from alerts where not coalesce(resolved, false) and severity = 'critical' and ${myAlert("$1")}) as open_critical,
            (select max(created_at) from sensor_readings where device_id in ${myDevices("$1")}) as last_reading_at,
            (select coalesce(sum(egg_count), 0)::int from hatcheries where farm_id in ${myFarms("$1")}) as eggs,
            (select coalesce(sum(hatched_count), 0)::int from hatcheries where farm_id in ${myFarms("$1")}) as hatched`,
        [u],
      ),
      query<{ temperature: number | null; humidity: number | null; created_at: string }>(
        `select temperature, humidity, created_at from sensor_readings
          where device_id in ${myDevices("$1")} order by created_at desc limit 24`,
        [u],
      ),
      query<Alert>(`select * from alerts where ${myAlert("$1")} order by created_at desc limit 5`, [
        u,
      ]),
      query<AiSnapshot>(LATEST_AI_SQL, [u]),
    ]);
    const c = counts!;
    // Missing data stays null so the UI shows "—" instead of a fake 0.
    const stats: DashboardStats = {
      totalBirds: c.total_birds,
      activeFarms: c.farms,
      temperature: c.temperature ?? null,
      humidity: c.humidity ?? null,
      activeAlerts: c.active_alerts,
      openCritical: c.open_critical,
      hatchRate: c.eggs > 0 ? +((c.hatched / c.eggs) * 100).toFixed(1) : null,
      lastReadingAt: c.last_reading_at ?? null,
    };
    return {
      stats,
      history: history.reverse(),
      recentAlerts,
      ai,
    };
  });

// Edge AI ---------------------------------------------------------------

export const getAiMonitor = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      deviceId: z.string().uuid().optional(),
      hours: z.number().min(1).max(168).default(6),
    }),
  )
  .handler(async ({ data, context }): Promise<AiMonitor> => {
    const latest = await query<AiSnapshot>(LATEST_AI_SQL, [context.user.id]);
    // Default to the most recently reporting device (LATEST_AI_SQL is newest first).
    // A device id from the URL only counts if this account owns it.
    const own = data.deviceId
      ? await queryOne("select 1 from devices where id = $1 and owner_id = $2", [
          data.deviceId,
          context.user.id,
        ])
      : null;
    const selected = (own ? data.deviceId : undefined) ?? latest[0]?.device_id;
    // At most ~MAX_POINTS points, always covering the whole range: ranges longer
    // than MAX_POINTS x 30 s keep the last reading in each date_bin bucket.
    const MAX_POINTS = 720;
    const rangeSec = data.hours * 3600;
    const bucketSeconds = rangeSec > MAX_POINTS * 30 ? Math.ceil(rangeSec / MAX_POINTS) : 0;
    const where = `device_id = $1 and ai_status is not null and created_at > now() - make_interval(hours => $2)`;
    const bin = `date_bin(make_interval(secs => $3::double precision), created_at, timestamptz '2000-01-01')`;
    let history: Reading[] = [];
    if (selected && bucketSeconds === 0) {
      history = await query<Reading>(
        `select * from sensor_readings where ${where} order by created_at desc limit ${MAX_POINTS}`,
        [selected, data.hours],
      );
    } else if (selected) {
      history = await query<Reading>(
        `select * from (
           select distinct on (${bin}) * from sensor_readings where ${where}
            order by ${bin}, created_at desc
         ) b
         order by created_at desc limit ${MAX_POINTS + 2}`,
        [selected, data.hours, bucketSeconds],
      );
    }
    return { latest, selected: selected ?? null, history: history.reverse(), bucketSeconds };
  });

// Farms & houses ----------------------------------------------------------

export const listFarms = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(({ context }) =>
    query<Farm>("select id, name from farms where owner_id = $1 order by name", [context.user.id]),
  );

export const listHouses = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const u = [context.user.id];
    const [houses, latest] = await Promise.all([
      query<House>(
        `select h.*, f.name as farm_name from poultry_houses h
           join farms f on f.id = h.farm_id
          where f.owner_id = $1 order by h.created_at`,
        u,
      ),
      query<Reading>(
        `select distinct on (house_id) * from sensor_readings
          where house_id is not null and device_id in ${myDevices("$1")}
          order by house_id, created_at desc`,
        u,
      ),
    ]);
    return {
      houses,
      latest: Object.fromEntries(latest.map((r) => [r.house_id!, r])) as Record<string, Reading>,
    };
  });

export const createHouse = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      farmId: z.string().uuid().optional(),
      name: z.string().min(1),
      capacity: z.number().int().min(0),
      birdCount: z.number().int().min(0),
      batchName: z.string().optional(),
      batchStartedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const farmId = await ensureFarm(data.farmId, context.user.id);
    await query(
      `insert into poultry_houses (farm_id, name, capacity, bird_count, batch_name, batch_started_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        farmId,
        data.name,
        data.capacity,
        data.birdCount,
        data.batchName || null,
        data.batchStartedAt || null,
      ],
    );
    return { ok: true };
  });

// Devices -----------------------------------------------------------------

export const listDevices = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const canSeeKeys = context.user.roles.some((r) => r === "admin" || r === "manager");
    const rows = await query<Device>(
      `select d.*, h.name as house_name from devices d
         left join poultry_houses h on h.id = d.house_id
        where d.owner_id = $1
        order by d.created_at desc`,
      [context.user.id],
    );
    // Offline after 3 missed 30 s check-ins: FRESHNESS_MS.live, the same threshold the UI uses for "live".
    return rows.map((d) => ({
      ...d,
      api_key: canSeeKeys ? d.api_key : "",
      online: !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() < FRESHNESS_MS.live,
    }));
  });

export const createDevice = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      // The Pi agent strips whitespace from agent.env values, so a stray space
      // here would make the ID impossible to match.
      deviceId: z.string().trim().min(1).max(64),
      // Devices that post readings: the Raspberry Pi (unit 1, incubator &
      // brooder) and the ESP32 coop controller (unit 2). The ESP32-CAM has no
      // API key: it is added under Cameras by its stream URL.
      type: z.enum(["pi", "coop"]).default("pi"),
      location: z.string().optional(),
      houseId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const apiKey = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const farmId = await ownHouseFarm(data.houseId, context.user.id);
    try {
      await query(
        `insert into devices (device_id, api_key, type, location, house_id, farm_id, owner_id, unit)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          data.deviceId,
          apiKey,
          data.type,
          data.location || null,
          data.houseId || null,
          farmId,
          context.user.id,
          data.type === "coop" ? "coop" : "brooder",
        ],
      );
    } catch (e) {
      // IDs are global (the Pi signs in with one), so it may be another account's.
      if (String(e).includes("devices_device_id_key"))
        throw new Error("That device ID is already taken. Pick another, e.g. PI-YOURFARM-A");
      throw e;
    }
    return { deviceId: data.deviceId, apiKey };
  });

export const updateDevice = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      houseId: z.string().uuid().nullable().optional(),
      fanOverride: z.enum(["on", "off"]).nullable().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const own = await queryOne("select 1 from devices where id = $1 and owner_id = $2", [
      data.id,
      context.user.id,
    ]);
    if (!own) throw new Error("Device not found");
    if (data.houseId !== undefined) {
      const farmId = await ownHouseFarm(data.houseId, context.user.id);
      await query("update devices set house_id = $2, farm_id = $3 where id = $1", [
        data.id,
        data.houseId,
        farmId,
      ]);
    }
    if (data.fanOverride !== undefined) {
      await query("update devices set fan_override = $2 where id = $1", [
        data.id,
        data.fanOverride,
      ]);
    }
    return { ok: true };
  });

// Alerts ------------------------------------------------------------------

// listAlerts() -> newest 100. listAlerts({ data: { days: 30 } }) -> every alert
// in that window (capped at 5000).
export const listAlerts = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .inputValidator(windowInput)
  .handler(({ data, context }) =>
    data?.days
      ? query<Alert>(
          `select * from alerts where ${myAlert("$2")} and created_at > now() - make_interval(days => $1)
            order by created_at desc limit 5000`,
          [data.days, context.user.id],
        )
      : query<Alert>(
          `select * from alerts where ${myAlert("$1")} order by created_at desc limit 100`,
          [context.user.id],
        ),
  );

export const resolveAlert = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await query(`update alerts set resolved = true where id = $1 and ${myAlert("$2")}`, [
      data.id,
      context.user.id,
    ]);
    return { ok: true };
  });

// Hatchery ----------------------------------------------------------------

export const listHatcheries = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(({ context }) =>
    query<Hatchery>(
      `select h.*, f.name as farm_name from hatcheries h
         join farms f on f.id = h.farm_id
        where f.owner_id = $1 order by h.created_at desc`,
      [context.user.id],
    ),
  );

export const createHatchery = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      farmId: z.string().uuid().optional(),
      name: z.string().trim().min(1),
      eggCount: z.number().int().min(1),
      // What the farmer dialled into the incubator. Nothing measures the
      // incubator, so these are records, not readings, and stay null if not given.
      temperature: z.number().min(30).max(40).nullable().optional(),
      humidity: z.number().min(20).max(90).nullable().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const farmId = await ensureFarm(data.farmId, context.user.id);
    const started = new Date();
    const expected = new Date(started.getTime() + 21 * 86400_000);
    await query(
      `insert into hatcheries (farm_id, name, egg_count, started_at, expected_hatch_at, temperature, humidity)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        farmId,
        data.name,
        data.eggCount,
        started.toISOString(),
        expected.toISOString(),
        data.temperature ?? null,
        data.humidity ?? null,
      ],
    );
    return { ok: true };
  });

/** Record how many chicks hatched (counted by hand). */
export const recordHatch = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(z.object({ id: z.string().uuid(), hatchedCount: z.number().int().min(0) }))
  .handler(async ({ data, context }) => {
    const row = await queryOne<{ egg_count: number | null }>(
      `select egg_count from hatcheries where id = $1 and farm_id in ${myFarms("$2")}`,
      [data.id, context.user.id],
    );
    if (!row) throw new Error("Batch not found");
    if (row.egg_count != null && data.hatchedCount > row.egg_count)
      throw new Error(`More chicks than eggs set (${row.egg_count})`);
    await query("update hatcheries set hatched_count = $2 where id = $1", [
      data.id,
      data.hatchedCount,
    ]);
    return { ok: true };
  });

// Cameras -----------------------------------------------------------------
// The ESP32-CAM (CameraWebServer firmware) is watched straight from the
// browser: MJPEG at http://<cam-ip>:81/stream, a still at http://<cam-ip>/capture.
// The server never contacts it, so there is no stored online status.

const streamUrl = z
  .string()
  .trim()
  .regex(/^https?:\/\/\S+$/i, "Use a full URL starting with http:// or https://")
  .max(500);

export const listCameras = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(({ context }) =>
    query<Camera>(
      `select c.id, c.name, c.stream_url, c.house_id, h.name as house_name, c.created_at
         from cameras c left join poultry_houses h on h.id = c.house_id
        where c.owner_id = $1
        order by c.created_at`,
      [context.user.id],
    ),
  );

export const createCamera = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      name: z.string().trim().min(1).max(80),
      streamUrl: streamUrl.optional(),
      houseId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const farmId = await ownHouseFarm(data.houseId, context.user.id);
    const row = await queryOne<{ id: string }>(
      `insert into cameras (name, stream_url, house_id, farm_id, owner_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [data.name, data.streamUrl || null, data.houseId || null, farmId, context.user.id],
    );
    return { id: row!.id };
  });

export const updateCamera = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
      streamUrl: streamUrl.nullable(),
      houseId: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const farmId = await ownHouseFarm(data.houseId, context.user.id);
    await query(
      `update cameras set name = $2, stream_url = $3, house_id = $4, farm_id = coalesce($5, farm_id)
        where id = $1 and owner_id = $6`,
      [data.id, data.name, data.streamUrl || null, data.houseId, farmId, context.user.id],
    );
    return { ok: true };
  });

export const deleteCamera = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await query("delete from cameras where id = $1 and owner_id = $2", [data.id, context.user.id]);
    return { ok: true };
  });
