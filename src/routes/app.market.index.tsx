import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { MapPin, Plus, Search, Store } from "lucide-react";
import { toast } from "sonner";
import {
  listInquiries,
  listListings,
  setInquiryStatus,
  type Inquiry,
  type Listing,
} from "@/lib/api/market.functions";
import { CATEGORIES, REGIONS, formatCedis, type Category } from "@/lib/market";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Grid,
  Input,
  PageHeader,
  RelativeTime,
  SegmentedControl,
  Select,
  SkeletonRows,
  StatusPill,
  Toolbar,
} from "@/components/ui-kit";
import { ListingForm } from "@/components/market/listing-form";

// The marketplace is shared by every account: farmers sell eggs, birds,
// chicks, manure and feed to each other. Listings, photos and messages all
// come from real accounts. Seller-written text carries translate="no" so the
// site translator leaves it exactly as written.

const search = z.object({
  tab: z.enum(["browse", "mine", "messages"]).optional().default("browse"),
});

export const Route = createFileRoute("/app/market/")({
  validateSearch: search,
  component: Market,
});

function Market() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: "/app/market/" });
  const [selling, setSelling] = useState(false);
  const inquiries = useQuery({
    queryKey: ["inquiries"],
    queryFn: () => listInquiries(),
    refetchInterval: 30_000,
  });
  const newCount = inquiries.data?.received.filter((i) => i.status === "new").length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marketplace"
        description="Buy and sell eggs, birds, chicks, feed and manure with other farmers."
        className="mb-0 md:mb-0"
      >
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setSelling(true)}
          data-tour="market-sell"
        >
          Sell something
        </Button>
      </PageHeader>

      <SegmentedControl
        ariaLabel="Marketplace view"
        value={tab}
        onChange={(t) => navigate({ search: { tab: t } })}
        options={[
          { value: "browse", label: "Browse" },
          { value: "mine", label: "My listings" },
          { value: "messages", label: newCount ? `Messages (${newCount} new)` : "Messages" },
        ]}
        className="self-start"
      />

      {tab === "browse" && <Browse onSell={() => setSelling(true)} />}
      {tab === "mine" && <Mine onSell={() => setSelling(true)} />}
      {tab === "messages" && (
        <Messages
          data={inquiries.data}
          loading={inquiries.isPending}
          refetch={() => void inquiries.refetch()}
        />
      )}

      {selling && (
        <ListingForm
          open
          onClose={(id) => {
            setSelling(false);
            if (id) navigate({ to: "/app/market/$listingId", params: { listingId: id } });
          }}
        />
      )}
    </div>
  );
}

function Browse({ onSell }: { onSell: () => void }) {
  const [category, setCategory] = useState<Category | "">("");
  const [region, setRegion] = useState<(typeof REGIONS)[number] | "">("");
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");
  const q = useQuery({
    queryKey: ["listings", category, region, submitted],
    queryFn: () =>
      listListings({
        data: {
          category: category || undefined,
          region: region || undefined,
          search: submitted || undefined,
        },
      }),
  });
  const filtered = !!(category || region || submitted);

  return (
    <div>
      <Toolbar>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(term.trim());
          }}
          className="relative min-w-[200px] flex-1"
          role="search"
        >
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <Input
            aria-label="Search the marketplace"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search eggs, broilers, Kumasi…"
            className="pl-9"
          />
        </form>
        <Select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "")}
          className="w-auto"
        >
          <option value="">All categories</option>
          {Object.entries(CATEGORIES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Region"
          value={region}
          onChange={(e) => setRegion(e.target.value as typeof region)}
          className="w-auto"
        >
          <option value="">All regions</option>
          {REGIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </Toolbar>

      {q.isPending ? (
        <SkeletonRows rows={3} cols={4} />
      ) : q.isError ? (
        <ErrorState
          title="Couldn’t load the marketplace"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.length === 0 ? (
        <EmptyState
          title={filtered ? "Nothing matches that yet" : "No listings yet"}
          description={
            filtered
              ? "Try another category, region or word."
              : "Be the first to sell. List your eggs, birds or manure and buyers can reach you here."
          }
          action={
            <Button variant="primary" icon={Plus} onClick={onSell}>
              Sell something
            </Button>
          }
        />
      ) : (
        <ListingGrid listings={q.data} />
      )}
    </div>
  );
}

function Mine({ onSell }: { onSell: () => void }) {
  const q = useQuery({
    queryKey: ["listings", "mine"],
    queryFn: () => listListings({ data: { mine: true } }),
  });
  if (q.isPending) return <SkeletonRows rows={2} cols={4} />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn’t load your listings"
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    );
  if (q.data.length === 0)
    return (
      <EmptyState
        title="You aren’t selling anything yet"
        description="Create a listing with a price and a photo. Buyers’ messages show up under Messages."
        action={
          <Button variant="primary" icon={Plus} onClick={onSell}>
            Sell something
          </Button>
        }
      />
    );
  return <ListingGrid listings={q.data} mine />;
}

function ListingGrid({ listings, mine }: { listings: Listing[]; mine?: boolean }) {
  return (
    <Grid cols={4}>
      {listings.map((l) => (
        <Link
          key={l.id}
          to="/app/market/$listingId"
          params={{ listingId: l.id }}
          className="pg-panel block overflow-hidden transition-shadow hover:shadow-md"
        >
          <div className="flex aspect-[4/3] items-center justify-center bg-sunken">
            {l.image_ids[0] ? (
              <img
                src={`/api/public/market/images/${l.image_ids[0]}`}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            ) : (
              <Store className="size-8 text-ink-3" aria-hidden strokeWidth={1.5} />
            )}
          </div>
          <div className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="line-clamp-2 text-[14px] font-medium text-ink" translate="no">
                {l.title}
              </div>
              {mine && <ListingStatus status={l.status} />}
            </div>
            <div className="pg-num mt-1 font-semibold text-ink">
              <span translate="no">{formatCedis(l.price)}</span>{" "}
              <span className="text-[12px] font-normal text-ink-3">per {l.unit}</span>
            </div>
            <div className="pg-t-caption mt-1 flex items-center gap-1">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span translate="no">
                {[l.location, l.region].filter(Boolean).join(", ") || "Ghana"}
              </span>
              <span>·</span>
              <RelativeTime iso={l.created_at} />
            </div>
            {mine ? (
              l.inquiry_count > 0 && (
                <div className="pg-t-caption mt-1">
                  {l.inquiry_count} {l.inquiry_count === 1 ? "message" : "messages"}
                  {l.new_inquiries > 0 && ` · ${l.new_inquiries} new`}
                </div>
              )
            ) : (
              <div className="pg-t-caption mt-1">
                Sold by <span translate="no">{l.seller_name ?? "a farmer"}</span>
              </div>
            )}
          </div>
        </Link>
      ))}
    </Grid>
  );
}

function ListingStatus({ status }: { status: Listing["status"] }) {
  if (status === "active")
    return (
      <StatusPill status="ok" size="sm">
        Live
      </StatusPill>
    );
  if (status === "sold")
    return (
      <StatusPill status="neutral" size="sm">
        Sold
      </StatusPill>
    );
  return (
    <StatusPill status="warn" size="sm">
      Paused
    </StatusPill>
  );
}

function Messages({
  data,
  loading,
  refetch,
}: {
  data: { received: Inquiry[]; sent: Inquiry[] } | undefined;
  loading: boolean;
  refetch: () => void;
}) {
  async function mark(id: string, status: "seen" | "closed") {
    try {
      await setInquiryStatus({ data: { id, status } });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t update the message");
    }
  }
  if (loading || !data) return <SkeletonRows rows={3} cols={3} />;
  if (!data.received.length && !data.sent.length)
    return (
      <EmptyState
        title="No messages yet"
        description="When a buyer asks about one of your listings, or you ask a seller, it shows up here."
      />
    );
  return (
    <Grid cols={2}>
      <Card title="From buyers" padding="none">
        {data.received.length ? (
          <ul className="divide-y divide-hairline">
            {data.received.map((i) => (
              <li key={i.id} className="px-4 py-3 text-[14px] md:px-5">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to="/app/market/$listingId"
                    params={{ listingId: i.listing_id }}
                    className="font-medium text-ink underline"
                    translate="no"
                  >
                    {i.listing_title}
                  </Link>
                  {i.status === "new" && (
                    <StatusPill status="info" size="sm">
                      New
                    </StatusPill>
                  )}
                </div>
                <p className="mt-1 text-ink" translate="no">
                  {i.message}
                </p>
                <div className="pg-t-caption mt-1 flex flex-wrap gap-x-2">
                  <span translate="no">{i.buyer_name ?? "Buyer"}</span>
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
                {i.status !== "closed" && (
                  <div className="mt-2 flex gap-2">
                    {i.status === "new" && (
                      <Button size="sm" onClick={() => void mark(i.id, "seen")}>
                        Mark as read
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void mark(i.id, "closed")}>
                      Done
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-[13px] text-ink-3 md:px-5">No buyer messages yet.</p>
        )}
      </Card>
      <Card title="Sent by you" padding="none">
        {data.sent.length ? (
          <ul className="divide-y divide-hairline">
            {data.sent.map((i) => (
              <li key={i.id} className="px-4 py-3 text-[14px] md:px-5">
                <Link
                  to="/app/market/$listingId"
                  params={{ listingId: i.listing_id }}
                  className="font-medium text-ink underline"
                  translate="no"
                >
                  {i.listing_title}
                </Link>
                <p className="mt-1 text-ink" translate="no">
                  {i.message}
                </p>
                <div className="pg-t-caption mt-1">
                  To <span translate="no">{i.seller_name ?? "the seller"}</span> ·{" "}
                  {i.status === "new" ? "not read yet" : i.status === "seen" ? "read" : "closed"} ·{" "}
                  <RelativeTime iso={i.created_at} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-[13px] text-ink-3 md:px-5">
            You haven’t messaged any sellers.
          </p>
        )}
      </Card>
    </Grid>
  );
}
