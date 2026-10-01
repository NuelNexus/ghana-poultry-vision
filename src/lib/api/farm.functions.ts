import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, queryOne } from "../db.server";
import { requireManager, requireUser } from "./middleware";
import type {
  AiSnapshot,
  Alert,
  BiogasRecord,
  Camera,
  Device,
  EnergyRecord,
  Farm,
  Hatchery,
  House,
  Reading,
} from "./types";

// Data access for the dashboard pages, backed by Neon.

async function ensureFarm(farmId: string | undefined, ownerId: string) {
  if (farmId) return farmId;
  const existing = await queryOne<{ id: string }>(
    "select id from farms order by created_at limit 1",
  );
  if (existing) return existing.id;
  const f = await queryOne<{ id: string }>(
    "insert into farms (name, owner_id) values ('Main Farm', $1) returning id",
    [ownerId],
  );
  return f!.id;
}

const LATEST_AI_SQL = `
  select distinct on (r.device_id) r.*, d.device_id as device_code, d.last_seen, h.name as house_name
    from sensor_readings r
    join devices d on d.id = r.device_id
    left join poultry_houses h on h.id = r.house_id
   where r.ai_status is not null
   order by r.device_id, r.created_at desc`;

// Dashboard -------------------------------------------------------------

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async () => {
    const [counts, history, recentAlerts, ai] = await Promise.all([
      queryOne<{
        total_birds: number;
        farms: number;
        temperature: number | null;
        humidity: number | null;
        solar: number | null;
        battery: number | null;
        active_alerts: number;
        eggs: number;
        hatched: number;
      }>(`select
            (select coalesce(sum(bird_count), 0)::int from poultry_houses) as total_birds,
            (select count(*)::int from farms) as farms,
            (select round(avg(temperature), 1) from (select temperature from sensor_readings order by created_at desc limit 20) t) as temperature,
            (select round(avg(humidity), 1) from (select humidity from sensor_readings order by created_at desc limit 20) t) as humidity,
            (select solar_w from energy_records order by created_at desc limit 1) as solar,
            (select battery_pct from energy_records order by created_at desc limit 1) as battery,
            (select count(*)::int from alerts where not coalesce(resolved, false)) as active_alerts,
            (select coalesce(sum(egg_count), 0)::int from hatcheries) as eggs,
            (select coalesce(sum(hatched_count), 0)::int from hatcheries) as hatched`),
      query<{ temperature: number | null; humidity: number | null; created_at: string }>(
        "select temperature, humidity, created_at from sensor_readings order by created_at desc limit 24",
      ),
      query<Alert>("select * from alerts order by created_at desc limit 5"),
      query<AiSnapshot>(LATEST_AI_SQL),
    ]);
    const c = counts!;
    return {
      stats: {
        totalBirds: c.total_birds,
        activeFarms: c.farms,
        temperature: c.temperature ?? 0,
        humidity: c.humidity ?? 0,
        solar: c.solar ?? 0,
        battery: c.battery ?? 0,
        activeAlerts: c.active_alerts,
        mortalityRate: 1.2,
        hatchRate: c.eggs > 0 ? +((c.hatched / c.eggs) * 100).toFixed(1) : 0,
      },
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
  .handler(async ({ data }) => {
    const latest = await query<AiSnapshot>(LATEST_AI_SQL);
    const selected = data.deviceId ?? latest[0]?.device_id;
    const history = selected
      ? await query<Reading>(
          `select * from sensor_readings
            where device_id = $1 and ai_status is not null and created_at > now() - make_interval(hours => $2)
            order by created_at desc limit 720`,
          [selected, data.hours],
        )
      : [];
    return { latest, selected: selected ?? null, history: history.reverse() };
  });

// Farms & houses ----------------------------------------------------------

export const listFarms = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(() => query<Farm>("select id, name from farms order by name"));

export const listHouses = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async () => {
    const [houses, latest] = await Promise.all([
      query<House>(`select h.*, f.name as farm_name from poultry_houses h
                    left join farms f on f.id = h.farm_id order by h.created_at`),
      query<Reading>(`select distinct on (house_id) * from sensor_readings
                      where house_id is not null order by house_id, created_at desc`),
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
    const rows = await query<Device>(`select d.*, h.name as house_name from devices d
                                      left join poultry_houses h on h.id = d.house_id
                                      order by d.created_at desc`);
    // Devices go offline in the UI after 3 missed 30 s check-ins.
    return rows.map((d) => ({
      ...d,
      api_key: canSeeKeys ? d.api_key : "",
      online: !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 90_000,
    }));
  });

export const createDevice = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      deviceId: z.string().min(1).max(64),
      type: z.enum(["pi", "sensor", "camera", "controller"]),
      location: z.string().optional(),
      houseId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const house = data.houseId
      ? await queryOne<{ farm_id: string }>("select farm_id from poultry_houses where id = $1", [
          data.houseId,
        ])
      : null;
    try {
      await query(
        `insert into devices (device_id, api_key, type, location, house_id, farm_id) values ($1, $2, $3, $4, $5, $6)`,
        [
          data.deviceId,
          apiKey,
          data.type,
          data.location || null,
          data.houseId || null,
          house?.farm_id ?? null,
        ],
      );
    } catch (e) {
      if (String(e).includes("devices_device_id_key"))
        throw new Error("A device with this ID already exists");
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
      fanOverride: z.enum(["low", "medium", "high"]).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    if (data.houseId !== undefined) {
      await query(
        `update devices set house_id = $2,
                farm_id = (select farm_id from poultry_houses where id = $2) where id = $1`,
        [data.id, data.houseId],
      );
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

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(() => query<Alert>("select * from alerts order by created_at desc limit 100"));

export const resolveAlert = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await query("update alerts set resolved = true where id = $1", [data.id]);
    return { ok: true };
  });

// Hatchery ----------------------------------------------------------------

export const listHatcheries = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(() =>
    query<Hatchery>(`select h.*, f.name as farm_name from hatcheries h
                                  left join farms f on f.id = h.farm_id order by h.created_at desc`),
  );

export const createHatchery = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      farmId: z.string().uuid().optional(),
      name: z.string().min(1),
      eggCount: z.number().int().min(0),
    }),
  )
  .handler(async ({ data, context }) => {
    const farmId = await ensureFarm(data.farmId, context.user.id);
    const started = new Date();
    const expected = new Date(started.getTime() + 21 * 86400_000);
    await query(
      `insert into hatcheries (farm_id, name, egg_count, started_at, expected_hatch_at, temperature, humidity)
       values ($1, $2, $3, $4, $5, 37.5, 55)`,
      [farmId, data.name, data.eggCount, started.toISOString(), expected.toISOString()],
    );
    return { ok: true };
  });

// Cameras -----------------------------------------------------------------

export const listCameras = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(() =>
    query<Camera>("select id, name, stream_url, status, created_at from cameras order by name"),
  );

export const createCamera = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(z.object({ name: z.string().min(1), streamUrl: z.string().optional() }))
  .handler(async ({ data }) => {
    await query("insert into cameras (name, stream_url, status) values ($1, $2, 'online')", [
      data.name,
      data.streamUrl || null,
    ]);
    return { ok: true };
  });

// Energy & biogas ---------------------------------------------------------

export const listEnergy = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(() =>
    query<EnergyRecord>("select * from energy_records order by created_at desc limit 48"),
  );

export const listBiogas = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(() =>
    query<BiogasRecord>("select * from biogas_records order by created_at desc limit 30"),
  );
