import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, MapPin, MessageCircle, Pencil, Phone, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteListing,
  getListing,
  sendInquiry,
  setInquiryStatus,
  setListingStatus,
} from "@/lib/api/market.functions";
import { CATEGORIES, formatCedis, whatsappNumber } from "@/lib/market";
import {
  Badge,
  Button,
  Card,
  EmptyAction,
  EmptyState,
  Field,
  Input,
  Modal,
  RelativeTime,
  SkeletonRows,
  StatusPill,
  Textarea,
  buttonClass,
} from "@/components/ui-kit";
import { ListingForm } from "@/components/market/listing-form";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/market/$listingId")({ component: ListingPage });

function ListingPage() {
  const { listingId } = Route.useParams();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["listing", listingId],
    queryFn: () => getListing({ data: { id: listingId } }),
  });
  const [photo, setPhoto] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (q.isPending) return <SkeletonRows rows={4} cols={2} />;
  if (q.isError)
    return (
      <EmptyState
        title="Listing not available"
        description={q.error.message}
        action={<EmptyAction to="/app/market">Back to the marketplace</EmptyAction>}
      />
    );
  const { listing: l, own, inquiries, myInquiries } = q.data;

  async function status(s: "active" | "paused" | "sold") {
    try {
      await setListingStatus({ data: { id: l.id, status: s } });
      toast.success(
        s === "sold" ? "Marked as sold" : s === "paused" ? "Hidden from buyers" : "Live again",
      );
      void q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t update the listing");
    }
  }

  async function remove() {
    try {
      await deleteListing({ data: { id: l.id } });
      toast.success("Listing deleted");
      navigate({ to: "/app/market", search: { tab: "mine" } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t delete the listing");
    }
  }

  return (
    <div>
      <Link
        to="/app/market"
        search={{ tab: own ? "mine" : "browse" }}
        className="pg-t-caption mb-4 inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" aria-hidden /> Marketplace
      </Link>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="pg-panel flex aspect-[4/3] items-center justify-center overflow-hidden bg-sunken">
            {l.image_ids.length ? (
              <img
                src={`/api/public/market/images/${l.image_ids[photo]}`}
                alt={l.title}
                className="size-full object-contain"
              />
            ) : (
              <Store className="size-12 text-ink-3" aria-hidden strokeWidth={1.5} />
            )}
          </div>
          {l.image_ids.length > 1 && (
            <div className="mt-2 flex gap-2">
              {l.image_ids.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  aria-label={`Photo ${i + 1}`}
                  onClick={() => setPhoto(i)}
                  className={cn(
                    "size-16 overflow-hidden rounded-md border-2",
                    i === photo ? "border-ink" : "border-transparent",
                  )}
                >
                  <img
                    src={`/api/public/market/images/${id}`}
                    alt=""
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {l.description && (
            <Card title="Details" className="mt-4">
              <p className="text-[14px] whitespace-pre-wrap text-ink" translate="no">
                {l.description}
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <div>
            <div className="flex items-center gap-2">
              <Badge>{CATEGORIES[l.category]}</Badge>
              {l.status === "sold" && (
                <StatusPill status="neutral" size="sm">
                  Sold
                </StatusPill>
              )}
              {l.status === "paused" && (
                <StatusPill status="warn" size="sm">
                  Paused
                </StatusPill>
              )}
            </div>
            <h1 className="pg-t-title mt-2" translate="no">
              {l.title}
            </h1>
            <div className="pg-num mt-1 text-[22px] font-semibold text-ink">
              <span translate="no">{formatCedis(l.price)}</span>{" "}
              <span className="text-[14px] font-normal text-ink-3">per {l.unit}</span>
            </div>
            {l.quantity != null && <div className="pg-t-caption">{l.quantity} available</div>}
            <div className="mt-2 flex items-center gap-1 text-[14px] text-ink-2">
              <MapPin className="size-4" aria-hidden />
              <span translate="no">
                {[l.location, l.region].filter(Boolean).join(", ") || "Ghana"}
              </span>
            </div>
            <div className="pg-t-caption mt-1">
              Sold by <span translate="no">{l.seller_name ?? "a farmer"}</span> · listed{" "}
              <RelativeTime iso={l.created_at} />
            </div>
          </div>

          {own ? (
            <Card title="Manage your listing">
              <div className="flex flex-wrap gap-2">
                <Button icon={Pencil} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                {l.status !== "sold" && (
                  <Button onClick={() => void status("sold")}>Mark as sold</Button>
                )}
                {l.status === "active" ? (
                  <Button onClick={() => void status("paused")}>Pause</Button>
                ) : (
                  <Button onClick={() => void status("active")}>Make live</Button>
                )}
                <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
            </Card>
          ) : (
            <>
              {l.contact_phone && (
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`tel:${l.contact_phone}`}
                    className={buttonClass({ variant: "primary", className: "flex-1" })}
                  >
                    <Phone aria-hidden strokeWidth={1.75} /> Call{" "}
                    <span translate="no">{l.contact_phone}</span>
                  </a>
                  {l.whatsapp && (
                    <a
                      href={`https://wa.me/${whatsappNumber(l.contact_phone)}?text=${encodeURIComponent(
                        `Hello, I saw "${l.title}" on PoultryGrid. Is it still available?`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonClass({ variant: "secondary" })}
                    >
                      <MessageCircle aria-hidden strokeWidth={1.75} /> WhatsApp
                    </a>
                  )}
                </div>
              )}
              <InquiryForm listingId={l.id} unit={l.unit} onSent={() => void q.refetch()} />
              {myInquiries.length > 0 && (
                <Card title="Your messages to this seller">
                  <ul className="flex flex-col gap-2 text-[14px]">
                    {myInquiries.map((m) => (
                      <li key={m.id}>
                        <span translate="no">{m.message}</span>
                        <div className="pg-t-caption">
                          <RelativeTime iso={m.created_at} /> ·{" "}
                          {m.status === "new"
                            ? "not read yet"
                            : m.status === "seen"
                              ? "read"
                              : "closed"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}

          {own && (
            <Card title={`Messages from buyers (${inquiries.length})`} padding="none">
              {inquiries.length ? (
                <ul className="divide-y divide-hairline">
                  {inquiries.map((i) => (
                    <li key={i.id} className="px-4 py-3 text-[14px] md:px-5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink" translate="no">
                          {i.buyer_name ?? "Buyer"}
                        </span>
                        {i.status === "new" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              await setInquiryStatus({ data: { id: i.id, status: "seen" } });
                              void q.refetch();
                            }}
                          >
                            Mark as read
                          </Button>
                        )}
                      </div>
                      <p className="text-ink" translate="no">
                        {i.message}
                      </p>
                      <div className="pg-t-caption mt-1 flex flex-wrap gap-x-2">
                        {i.quantity != null && <span>wants {i.quantity}</span>}
                        {i.buyer_phone && (
                          <a href={`tel:${i.buyer_phone}`} className="underline" translate="no">
                            {i.buyer_phone}
                          </a>
                        )}
                        {i.buyer_email && (
                          <a href={`mailto:${i.buyer_email}`} className="underline" translate="no">
                            {i.buyer_email}
                          </a>
                        )}
                        <RelativeTime iso={i.created_at} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 pb-4 text-[13px] text-ink-3 md:px-5">
                  No messages yet. Buyers can message you from this page.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      {editing && (
        <ListingForm
          open
          existing={l}
          onClose={(id) => {
            setEditing(false);
            if (id) void q.refetch();
          }}
        />
      )}
      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this listing?"
        description="Its photos and buyers’ messages are deleted too. This can’t be undone."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-2">
          To stop selling for now, use Pause instead. You can make it live again later.
        </p>
      </Modal>
    </div>
  );
}

function InquiryForm({
  listingId,
  unit,
  onSent,
}: {
  listingId: string;
  unit: string;
  onSent: () => void;
}) {
  const [message, setMessage] = useState("Hello, is this still available?");
  const [quantity, setQuantity] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await sendInquiry({
        data: {
          listingId,
          message,
          quantity: quantity === "" ? null : Number(quantity),
          phone: phone || undefined,
        },
      });
      toast.success("Message sent to the seller");
      setMessage("");
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t send the message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Message the seller"
      description="The seller sees your name, email and the phone you add."
    >
      <form onSubmit={submit} className="flex flex-col gap-3" data-tour="market-message">
        <Field label="Message" required>
          <Textarea
            name="message"
            value={message}
            maxLength={1000}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`How many (${unit})?`}>
            <Input
              name="quantity"
              type="number"
              min={0}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label="Your phone" hint="Optional">
            <Input
              name="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Button variant="primary" type="submit" loading={busy}>
          Send message
        </Button>
      </form>
    </Card>
  );
}
