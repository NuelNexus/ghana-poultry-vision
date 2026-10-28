import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { createListing, updateListing, type Listing } from "@/lib/api/market.functions";
import {
  CATEGORIES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  REGIONS,
  UNITS,
  type Category,
  type SaleUnit,
} from "@/lib/market";
import { Button, Field, Input, Modal, Select, Switch, Textarea } from "@/components/ui-kit";

type NewImage = { mime: "image/jpeg"; base64: string; preview: string };

/** Shrink a photo to at most 1280 px and under the size limit, as JPEG, before upload. */
async function compress(file: File): Promise<NewImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn’t a photo we can read"));
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const base64 = dataUrl.split(",")[1];
      if ((base64.length * 3) / 4 <= MAX_IMAGE_BYTES)
        return { mime: "image/jpeg", base64, preview: dataUrl };
    }
    throw new Error("That photo is too large, even after shrinking it");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ListingForm({
  open,
  existing,
  onClose,
}: {
  open: boolean;
  existing?: Listing;
  onClose: (savedId?: string) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [category, setCategory] = useState<Category>(existing?.category ?? "eggs");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [price, setPrice] = useState(existing ? String(existing.price) : "");
  const [unit, setUnit] = useState<SaleUnit>(existing?.unit ?? "crate");
  const [quantity, setQuantity] = useState(
    existing?.quantity != null ? String(existing.quantity) : "",
  );
  const [region, setRegion] = useState(existing?.region ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [phone, setPhone] = useState(existing?.contact_phone ?? "");
  const [whatsapp, setWhatsapp] = useState(existing?.whatsapp ?? true);
  const [keepIds, setKeepIds] = useState<string[]>(existing?.image_ids ?? []);
  const [added, setAdded] = useState<NewImage[]>([]);
  const [busy, setBusy] = useState(false);

  const photoCount = keepIds.length + added.length;

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_IMAGES - photoCount;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) toast.info(`Up to ${MAX_IMAGES} photos per listing`);
    try {
      const imgs = await Promise.all(picked.map(compress));
      setAdded((a) => [...a, ...imgs]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t add the photo");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fields = {
      title,
      category,
      description,
      price: Number(price),
      unit,
      quantity: quantity === "" ? null : Number(quantity),
      region: (region || undefined) as (typeof REGIONS)[number] | undefined,
      location,
      contactPhone: phone,
      whatsapp,
    };
    const images = added.map(({ mime, base64 }) => ({ mime, base64 }));
    setBusy(true);
    try {
      if (existing) {
        await updateListing({
          data: {
            ...fields,
            id: existing.id,
            addImages: images,
            removeImageIds: existing.image_ids.filter((id) => !keepIds.includes(id)),
          },
        });
        toast.success("Listing updated");
        onClose(existing.id);
      } else {
        const res = await createListing({ data: { ...fields, images } });
        toast.success("Your listing is live");
        onClose(res.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save the listing");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={existing ? "Edit listing" : "Sell on the marketplace"}
      description="Other farmers see this on the marketplace and can call, WhatsApp or message you."
      footer={
        <>
          <Button onClick={() => onClose()}>Cancel</Button>
          <Button variant="primary" type="submit" form="listing-form" loading={busy}>
            {existing ? "Save changes" : "Publish listing"}
          </Button>
        </>
      }
    >
      <form id="listing-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="What are you selling?" required>
          <Input
            name="title"
            value={title}
            minLength={3}
            maxLength={120}
            placeholder="Fresh eggs, large…"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {Object.entries(CATEGORIES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Region">
            <Select name="region" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Choose…</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Price (GH₵)" required>
            <Input
              name="price"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Per">
            <Select name="unit" value={unit} onChange={(e) => setUnit(e.target.value as SaleUnit)}>
              {Object.entries(UNITS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How many?" hint="Optional">
            <Input
              name="quantity"
              type="number"
              min={0}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Town or area">
          <Input
            name="location"
            value={location}
            maxLength={120}
            placeholder="Ejisu…"
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>
        <Field label="Details" hint="Size, age, breed, delivery, anything a buyer should know.">
          <Textarea
            name="description"
            value={description}
            maxLength={2000}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 items-end gap-3">
          <Field label="Phone for buyers" hint="Optional. Leave empty to get messages here only.">
            <Input
              name="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              placeholder="024 123 4567"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-3 pb-6 text-[14px] text-ink">
            <Switch
              label="This number is on WhatsApp"
              checked={!!phone && whatsapp}
              disabled={!phone}
              onCheckedChange={setWhatsapp}
            />
            On WhatsApp
          </label>
        </div>

        <div>
          <div className="mb-1.5 text-[13px] leading-[18px] font-medium text-ink">
            Photos ({photoCount}/{MAX_IMAGES})
          </div>
          <div className="flex flex-wrap gap-2">
            {keepIds.map((id) => (
              <Thumb
                key={id}
                src={`/api/public/market/images/${id}`}
                onRemove={() => setKeepIds((k) => k.filter((x) => x !== id))}
              />
            ))}
            {added.map((img, i) => (
              <Thumb
                key={i}
                src={img.preview}
                onRemove={() => setAdded((a) => a.filter((_, j) => j !== i))}
              />
            ))}
            {photoCount < MAX_IMAGES && (
              <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong text-[12px] text-ink-3">
                <ImagePlus className="size-5" aria-hidden strokeWidth={1.75} />
                Add photo
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => void addPhotos(e.target.files)}
                />
              </label>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Thumb({ src, onRemove }: { src: string; onRemove: () => void }) {
  return (
    <div className="relative size-20">
      <img src={src} alt="" className="size-20 rounded-md border border-hairline object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-surface"
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}
