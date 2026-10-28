import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, queryOne } from "../db.server";
import { CATEGORIES, MAX_IMAGES, MAX_IMAGE_BYTES, REGIONS, UNITS } from "../market";
import { requireUser } from "./middleware";

// Marketplace: every listing, image and inquiry belongs to a real account.
// Any signed-in user can buy and sell.

export interface Listing {
  id: string;
  seller_id: string;
  seller_name: string | null;
  title: string;
  category: keyof typeof CATEGORIES;
  description: string | null;
  price: number;
  unit: keyof typeof UNITS;
  quantity: number | null;
  region: string | null;
  location: string | null;
  contact_phone: string | null;
  whatsapp: boolean;
  status: "active" | "paused" | "sold";
  image_ids: string[];
  inquiry_count: number;
  new_inquiries: number;
  created_at: string;
  updated_at: string;
}

export interface Inquiry {
  id: string;
  listing_id: string;
  listing_title: string;
  buyer_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  seller_name: string | null;
  message: string;
  quantity: number | null;
  buyer_phone: string | null;
  status: "new" | "seen" | "closed";
  created_at: string;
}

const LISTING_SELECT = `
  select l.*, u.full_name as seller_name,
         coalesce((select array_agg(i.id order by i.position) from listing_images i where i.listing_id = l.id), '{}') as image_ids,
         (select count(*)::int from inquiries q where q.listing_id = l.id) as inquiry_count,
         (select count(*)::int from inquiries q where q.listing_id = l.id and q.status = 'new') as new_inquiries
    from listings l join users u on u.id = l.seller_id`;

/** Inquiry counts are only for the seller's eyes. */
function forViewer(l: Listing, viewerId: string): Listing {
  const own = l.seller_id === viewerId;
  return {
    ...l,
    inquiry_count: own ? l.inquiry_count : 0,
    new_inquiries: own ? l.new_inquiries : 0,
  };
}

export const listListings = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      category: z.enum(Object.keys(CATEGORIES) as [keyof typeof CATEGORIES]).optional(),
      region: z.enum(REGIONS).optional(),
      search: z.string().max(80).optional(),
      mine: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (data.mine) where.push(`l.seller_id = ${p(context.user.id)}`);
    else where.push(`l.status = 'active'`);
    if (data.category) where.push(`l.category = ${p(data.category)}`);
    if (data.region) where.push(`l.region = ${p(data.region)}`);
    if (data.search?.trim()) {
      const term = p(`%${data.search.trim()}%`);
      where.push(
        `(l.title ilike ${term} or l.description ilike ${term} or l.location ilike ${term})`,
      );
    }
    const rows = await query<Listing>(
      `${LISTING_SELECT} where ${where.join(" and ")} order by l.created_at desc limit 200`,
      params,
    );
    return rows.map((l) => forViewer(l, context.user.id));
  });

export const getListing = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const l = await queryOne<Listing>(`${LISTING_SELECT} where l.id = $1`, [data.id]);
    if (!l || (l.status !== "active" && l.seller_id !== context.user.id)) {
      throw new Error("This listing is no longer available");
    }
    const own = l.seller_id === context.user.id;
    const inquiries = own
      ? await query<Inquiry>(
          `select q.*, l.title as listing_title, u.full_name as buyer_name, u.email as buyer_email
             from inquiries q join listings l on l.id = q.listing_id join users u on u.id = q.buyer_id
            where q.listing_id = $1 order by q.created_at desc`,
          [data.id],
        )
      : [];
    const myInquiries = own
      ? []
      : await query<Pick<Inquiry, "id" | "message" | "status" | "created_at">>(
          "select id, message, status, created_at from inquiries where listing_id = $1 and buyer_id = $2 order by created_at desc",
          [data.id, context.user.id],
        );
    return { listing: forViewer(l, context.user.id), own, inquiries, myInquiries };
  });

const imageSchema = z.object({
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8),
});

const listingFields = z.object({
  title: z.string().trim().min(3).max(120),
  category: z.enum(Object.keys(CATEGORIES) as [keyof typeof CATEGORIES]),
  description: z.string().trim().max(2000).optional(),
  price: z.number().min(0).max(10_000_000),
  unit: z.enum(Object.keys(UNITS) as [keyof typeof UNITS]),
  quantity: z.number().min(0).max(10_000_000).nullable().optional(),
  region: z.enum(REGIONS).optional(),
  location: z.string().trim().max(120).optional(),
  contactPhone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s-]{6,18}$/, "Enter a phone number like 024 123 4567")
    .optional()
    .or(z.literal("")),
  whatsapp: z.boolean().default(false),
});

async function saveImages(listingId: string, images: z.infer<typeof imageSchema>[], startAt = 0) {
  for (const [i, img] of images.entries()) {
    await query(
      "insert into listing_images (listing_id, position, mime, data) values ($1, $2, $3, decode($4, 'base64'))",
      [listingId, startAt + i, img.mime, img.base64],
    );
  }
}

export const createListing = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    listingFields.extend({ images: z.array(imageSchema).max(MAX_IMAGES).default([]) }),
  )
  .handler(async ({ data, context }) => {
    const row = await queryOne<{ id: string }>(
      `insert into listings (seller_id, title, category, description, price, unit, quantity, region, location,
                             contact_phone, whatsapp)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        context.user.id,
        data.title,
        data.category,
        data.description || null,
        data.price,
        data.unit,
        data.quantity ?? null,
        data.region ?? null,
        data.location || null,
        data.contactPhone || null,
        !!data.contactPhone && data.whatsapp,
      ],
    );
    await saveImages(row!.id, data.images);
    return { id: row!.id };
  });

async function ownListing(id: string, userId: string) {
  const l = await queryOne<{ id: string }>(
    "select id from listings where id = $1 and seller_id = $2",
    [id, userId],
  );
  if (!l) throw new Error("You can only change your own listings");
}

export const updateListing = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    listingFields.extend({
      id: z.string().uuid(),
      addImages: z.array(imageSchema).max(MAX_IMAGES).default([]),
      removeImageIds: z.array(z.string().uuid()).default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    await ownListing(data.id, context.user.id);
    await query(
      `update listings set title = $2, category = $3, description = $4, price = $5, unit = $6, quantity = $7,
              region = $8, location = $9, contact_phone = $10, whatsapp = $11, updated_at = now()
        where id = $1`,
      [
        data.id,
        data.title,
        data.category,
        data.description || null,
        data.price,
        data.unit,
        data.quantity ?? null,
        data.region ?? null,
        data.location || null,
        data.contactPhone || null,
        !!data.contactPhone && data.whatsapp,
      ],
    );
    if (data.removeImageIds.length) {
      await query("delete from listing_images where listing_id = $1 and id = any($2::uuid[])", [
        data.id,
        data.removeImageIds,
      ]);
    }
    const count = await queryOne<{ n: number; next: number }>(
      "select count(*)::int as n, coalesce(max(position) + 1, 0)::int as next from listing_images where listing_id = $1",
      [data.id],
    );
    if (count!.n + data.addImages.length > MAX_IMAGES)
      throw new Error(`Up to ${MAX_IMAGES} photos per listing`);
    await saveImages(data.id, data.addImages, count!.next);
    return { ok: true };
  });

export const setListingStatus = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ id: z.string().uuid(), status: z.enum(["active", "paused", "sold"]) }))
  .handler(async ({ data, context }) => {
    await ownListing(data.id, context.user.id);
    await query("update listings set status = $2, updated_at = now() where id = $1", [
      data.id,
      data.status,
    ]);
    return { ok: true };
  });

export const deleteListing = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await ownListing(data.id, context.user.id);
    await query("delete from listings where id = $1", [data.id]);
    return { ok: true };
  });

export const sendInquiry = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      listingId: z.string().uuid(),
      message: z.string().trim().min(1).max(1000),
      quantity: z.number().min(0).max(10_000_000).nullable().optional(),
      phone: z.string().trim().max(20).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const l = await queryOne<{ seller_id: string; status: string }>(
      "select seller_id, status from listings where id = $1",
      [data.listingId],
    );
    if (!l || l.status !== "active") throw new Error("This listing is no longer available");
    if (l.seller_id === context.user.id) throw new Error("This is your own listing");
    await query(
      "insert into inquiries (listing_id, buyer_id, message, quantity, buyer_phone) values ($1,$2,$3,$4,$5)",
      [data.listingId, context.user.id, data.message, data.quantity ?? null, data.phone || null],
    );
    return { ok: true };
  });

export const listInquiries = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const [received, sent] = await Promise.all([
      query<Inquiry>(
        `select q.*, l.title as listing_title, b.full_name as buyer_name, b.email as buyer_email, s.full_name as seller_name
           from inquiries q join listings l on l.id = q.listing_id
           join users b on b.id = q.buyer_id join users s on s.id = l.seller_id
          where l.seller_id = $1 order by q.created_at desc limit 200`,
        [context.user.id],
      ),
      query<Inquiry>(
        `select q.*, l.title as listing_title, b.full_name as buyer_name, null as buyer_email, s.full_name as seller_name
           from inquiries q join listings l on l.id = q.listing_id
           join users b on b.id = q.buyer_id join users s on s.id = l.seller_id
          where q.buyer_id = $1 order by q.created_at desc limit 200`,
        [context.user.id],
      ),
    ]);
    return { received, sent };
  });

export const setInquiryStatus = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ id: z.string().uuid(), status: z.enum(["seen", "closed"]) }))
  .handler(async ({ data, context }) => {
    // Only the seller of the listing can mark an inquiry
    await query(
      `update inquiries q set status = $2
         from listings l where l.id = q.listing_id and q.id = $1 and l.seller_id = $3`,
      [data.id, data.status, context.user.id],
    );
    return { ok: true };
  });
