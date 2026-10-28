import { createFileRoute } from "@tanstack/react-router";
import { queryOne } from "@/lib/db.server";
import { getSessionUser } from "@/lib/auth.server";

// Listing photos, stored in Neon. Signed-in users only, like the marketplace.
export const Route = createFileRoute("/api/public/market/images/$imageId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.imageId))
          return new Response("Not found", { status: 404 });
        if (!(await getSessionUser()))
          return new Response("Sign in to see photos", { status: 401 });
        const img = await queryOne<{ mime: string; b64: string }>(
          "select mime, encode(data, 'base64') as b64 from listing_images where id = $1",
          [params.imageId],
        );
        if (!img) return new Response("Not found", { status: 404 });
        const bytes = Uint8Array.from(atob(img.b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            "content-type": img.mime,
            // Photos never change once uploaded (edits add new ids)
            "cache-control": "private, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
