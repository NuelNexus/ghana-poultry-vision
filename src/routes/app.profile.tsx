import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Check, KeyRound, Lock, LogOut, Pipette, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  changePassword,
  getAccount,
  signOutOtherSessions,
  updateProfile,
} from "@/lib/api/auth.functions";
import { listDevices, listFarms, listHouses } from "@/lib/api/farm.functions";
import {
  Button,
  Card,
  DescList,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonText,
  StatusDot,
  StatusPill,
  Switch,
  formatDate,
  formatNumber,
  formatTime,
  formatTemp,
  toTemp,
  tempUnit,
  useDisplayPrefs,
} from "@/components/ui-kit";
import { useTheme } from "@/components/ThemeProvider";
import {
  ACCENTS,
  FAMILIES,
  FONTS,
  MONO_FONTS,
  PRESETS,
  avatarHue,
  deriveBrand,
  ensureFontLink,
  fontUrl,
  initialsOf,
  isCustomised,
  paletteVars,
  type FontId,
  type AiLang,
  type MonoId,
  type Preset,
  type ThemeSettings,
} from "@/lib/theme";
import { SPEECH_LANGS } from "@/lib/ai-languages";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/profile")({
  component: ProfilePage,
});

type RoleName = "admin" | "manager" | "worker";

const ROLE_LABEL: Record<RoleName, string> = {
  admin: "Admin",
  manager: "Manager",
  worker: "Worker",
};

const ROLE_SUMMARY: Record<RoleName, string> = {
  admin: "Farm owner. Full access to setup and data.",
  manager: "Runs farm setup: houses, devices, cameras and batches.",
  worker: "Day-to-day monitoring. Setup changes need a manager.",
};

/** Mirrors requireUser / requireManager in src/lib/api/*.functions.ts. */
const CAPABILITIES: { label: string; managers: boolean }[] = [
  { label: "View houses, readings, cameras and reports", managers: false },
  { label: "Resolve alerts", managers: false },
  { label: "Ask the AI assistant", managers: false },
  { label: "Add houses and set flock batches", managers: true },
  { label: "Register devices and see their API keys", managers: true },
  { label: "Start hatchery batches and record hatches", managers: true },
  { label: "Add, edit and remove cameras", managers: true },
];

const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "security", label: "Security" },
  { id: "appearance", label: "Appearance" },
  { id: "preferences", label: "Preferences" },
  { id: "about", label: "Farm system" },
] as const;

function ProfilePage() {
  // Re-render previews (times, temperatures) when display preferences change.
  useDisplayPrefs();
  return (
    <>
      <PageHeader
        title="Profile"
        description="Your account, sign-in security and how the console looks on this device."
      />
      <div className="grid gap-8 lg:grid-cols-[168px_minmax(0,1fr)] xl:gap-12">
        <nav aria-label="Profile sections" className="hidden lg:block">
          <ul className="sticky top-20 flex flex-col gap-px">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block rounded-md px-2 py-1.5 text-[13px] leading-[18px] font-medium text-ink-2 no-underline transition-colors hover:bg-sunken hover:text-ink"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-10">
          <AccountSection />
          <SecuritySection />
          <AppearanceSection />
          <AccessibilitySection />
          <PreferencesSection />
          <AboutSection />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Account
 * -------------------------------------------------------------------------- */

function useAccount() {
  return useQuery({ queryKey: ["account"], queryFn: () => getAccount(), staleTime: 30_000 });
}

function primaryRole(roles: readonly string[]): RoleName {
  return roles.includes("admin") ? "admin" : roles.includes("manager") ? "manager" : "worker";
}

function Avatar({ id, name, size = 48 }: { id?: string; name: string; size?: number }) {
  return (
    <span
      className="pg-avatar"
      aria-hidden
      style={
        {
          "--pg-av": avatarHue(id),
          width: size,
          height: size,
          fontSize: Math.round(size * 0.36),
        } as CSSProperties
      }
    >
      {initialsOf(name)}
    </span>
  );
}

function AccountSection() {
  const { user, roles, patchUser } = useAuth();
  const account = useAccount();
  const role = primaryRole(roles);
  const display = user?.full_name?.trim() || user?.email?.split("@")[0] || "Operator";

  const [name, setName] = useState(user?.full_name ?? "");
  // Follow the server value until the user starts typing.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setName(user?.full_name ?? "");
  }, [user?.full_name, touched]);

  const trimmed = name.trim();
  const nameError =
    touched && !trimmed
      ? "Enter your name"
      : trimmed.length > 120
        ? "Use 120 characters or fewer"
        : undefined;
  const dirty = trimmed !== (user?.full_name ?? "").trim();

  const save = useMutation({
    mutationFn: (fullName: string) => updateProfile({ data: { fullName } }),
    onSuccess: async (r) => {
      await patchUser({ full_name: r.fullName });
      setTouched(false);
      toast.success("Name updated");
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't save your name"),
  });

  return (
    <Section id="account" title="Account">
      <Card padding="none">
        <div className="flex flex-wrap items-center gap-4 p-4 md:p-5">
          <Avatar id={user?.id} name={display} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[16px] leading-6 font-semibold text-ink">
                {display}
              </span>
              <StatusPill status="brand">{ROLE_LABEL[role]}</StatusPill>
            </div>
            <div className="pg-t-caption mt-0.5 truncate" translate="no">
              {user?.email}
            </div>
          </div>
          <div className="pg-t-caption w-full sm:w-auto sm:text-right">
            {account.isPending ? (
              <Skeleton className="h-4 w-32" />
            ) : account.data ? (
              <>Member since {formatDate(account.data.created_at)}</>
            ) : null}
          </div>
        </div>

        <form
          className="grid gap-4 border-t border-hairline p-4 md:grid-cols-2 md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!trimmed || trimmed.length > 120 || !dirty) return;
            save.mutate(trimmed);
          }}
        >
          <Field
            label="Full name"
            error={nameError}
            hint="Shown in the sidebar and on alerts you resolve."
          >
            <Input
              name="name"
              autoComplete="name"
              value={name}
              maxLength={160}
              placeholder="Ama Mensah…"
              onChange={(e) => {
                setTouched(true);
                setName(e.target.value);
              }}
            />
          </Field>
          <Field label="Email" hint="Used to sign in. It can’t be changed here.">
            <Input
              name="email"
              type="email"
              value={user?.email ?? ""}
              readOnly
              disabled
              translate="no"
            />
          </Field>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={!dirty || !!nameError}
            >
              Save name
            </Button>
            {dirty && !save.isPending && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setTouched(false);
                  setName(user?.full_name ?? "");
                }}
              >
                Discard
              </Button>
            )}
          </div>
        </form>

        <div className="border-t border-hairline p-4 md:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="pg-t-h3">What {role === "admin" ? "an admin" : `a ${role}`} can do</h3>
            <p className="pg-t-caption">{ROLE_SUMMARY[role]}</p>
          </div>
          <ul className="mt-3 grid gap-x-8 gap-y-2 md:grid-cols-2">
            {CAPABILITIES.map((c) => {
              const allowed = !c.managers || role !== "worker";
              return (
                <li key={c.label} className="flex items-start gap-2 text-[13px] leading-[18px]">
                  {allowed ? (
                    <Check className="mt-px size-4 shrink-0 text-ok" aria-hidden />
                  ) : (
                    <Lock className="mt-px size-4 shrink-0 text-ink-disabled" aria-hidden />
                  )}
                  <span className={allowed ? "text-ink" : "text-ink-3"}>
                    {c.label}
                    {!allowed && <span className="sr-only"> (managers only)</span>}
                    {!allowed && (
                      <span className="text-ink-3" aria-hidden>
                        {" "}
                        · managers
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {role === "worker" && (
            <p className="pg-t-caption mt-3">
              Ask the farm owner to make you a manager if you run setup.
            </p>
          )}
        </div>
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------------------- *
 * Security
 * -------------------------------------------------------------------------- */

function SecuritySection() {
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const account = useAccount();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const showId = useId();
  const othersId = useId();

  const errors = {
    current: submitted && !current ? "Enter your current password" : (serverError ?? undefined),
    next:
      submitted && next.length < 8
        ? "Use at least 8 characters"
        : submitted && next && next === current
          ? "Choose a password you haven’t used here"
          : undefined,
    confirm:
      (submitted || confirm.length >= next.length) && confirm && confirm !== next
        ? "Passwords don’t match"
        : submitted && !confirm
          ? "Re-enter the new password"
          : undefined,
  };
  const valid = !!current && next.length >= 8 && next !== current && confirm === next;

  const change = useMutation({
    mutationFn: () => changePassword({ data: { current, next, signOutOthers } }),
    onSuccess: (r) => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setSubmitted(false);
      void qc.invalidateQueries({ queryKey: ["account"] });
      toast.success(
        r.signedOut
          ? `Password updated. Signed out ${r.signedOut} other ${r.signedOut === 1 ? "device" : "devices"}.`
          : "Password updated",
      );
    },
    onError: (e: Error) => {
      if (/current password/i.test(e.message)) setServerError(e.message);
      else toast.error(e.message || "Couldn't update the password");
    },
  });

  const others = useMutation({
    mutationFn: () => signOutOtherSessions(),
    onSuccess: (r) => {
      setConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: ["account"] });
      toast.success(
        r.signedOut
          ? `Signed out ${r.signedOut} other ${r.signedOut === 1 ? "device" : "devices"}`
          : "No other devices were signed in",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't sign out other devices"),
  });

  const sessions = account.data?.sessions ?? null;
  const otherCount = sessions == null ? null : Math.max(0, sessions - 1);
  const pwType = show ? "text" : "password";

  return (
    <Section id="security" title="Security">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <Card
          title="Change password"
          description="At least 8 characters. A short phrase is easier to type on a phone."
        >
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (!valid) return;
              setServerError(null);
              change.mutate();
            }}
          >
            {/* Lets password managers associate the new password with this account. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={account.data?.email ?? ""}
              readOnly
              hidden
            />
            <Field label="Current password" error={errors.current}>
              <Input
                name="current-password"
                type={pwType}
                autoComplete="current-password"
                value={current}
                onChange={(e) => {
                  setCurrent(e.target.value);
                  setServerError(null);
                }}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="New password"
                error={errors.next}
                hint={
                  next.length > 0 && next.length < 8
                    ? `${8 - next.length} more characters`
                    : undefined
                }
              >
                <Input
                  name="new-password"
                  type={pwType}
                  autoComplete="new-password"
                  minLength={8}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password" error={errors.confirm}>
                <Input
                  name="confirm-password"
                  type={pwType}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-col gap-3">
              <label
                htmlFor={showId}
                className="flex w-fit cursor-pointer items-center gap-2 text-[13px] leading-[18px] text-ink-2"
              >
                <input
                  id={showId}
                  type="checkbox"
                  checked={show}
                  onChange={(e) => setShow(e.target.checked)}
                  className="size-4 accent-[var(--pg-brand)]"
                />
                Show passwords
              </label>
              <div className="flex items-center gap-3">
                <Switch id={othersId} checked={signOutOthers} onCheckedChange={setSignOutOthers} />
                <label
                  htmlFor={othersId}
                  className="cursor-pointer text-[13px] leading-[18px] text-ink-2"
                >
                  Sign out other devices after the change
                </label>
              </div>
            </div>
            <div>
              <Button type="submit" variant="primary" icon={KeyRound} loading={change.isPending}>
                Update password
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Where you’re signed in" description="Sessions last 30 days on each browser.">
          {account.isPending ? (
            <SkeletonText lines={3} />
          ) : account.isError ? (
            <ErrorState
              title="Couldn't load sessions"
              error={account.error}
              onRetry={() => void account.refetch()}
            />
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[14px] leading-5 font-medium text-ink">
                    This device
                    <StatusPill status="ok" size="sm">
                      Current
                    </StatusPill>
                  </div>
                  <p className="pg-t-caption mt-0.5">The browser you’re using now.</p>
                </div>
                <Button size="sm" icon={LogOut} onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
                <div className="min-w-0">
                  <div className="pg-num text-[14px] leading-5 font-medium text-ink">
                    {otherCount === 0
                      ? "No other devices"
                      : `${otherCount} other ${otherCount === 1 ? "device" : "devices"}`}
                  </div>
                  <p className="pg-t-caption mt-0.5">
                    {otherCount === 0
                      ? "You’re only signed in here."
                      : "Phones, tablets or browsers still signed in to this account."}
                  </p>
                </div>
                {!!otherCount && (
                  <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
                    Sign out all
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out other devices?"
        description={`${otherCount ?? 0} other ${otherCount === 1 ? "session" : "sessions"} will end. This device stays signed in.`}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={others.isPending} onClick={() => others.mutate()}>
              Sign out other devices
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-5 text-ink-2">
          Anyone using those devices will need your password to sign in again. Do this if you lost a
          phone or shared your password.
        </p>
      </Modal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- *
 * Appearance
 * -------------------------------------------------------------------------- */

function SettingRow({
  label,
  hint,
  labelId,
  children,
}: {
  label: string;
  hint?: ReactNode;
  labelId?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2.5 py-4 first:pt-0 last:pb-0 md:grid-cols-[176px_minmax(0,1fr)] md:gap-6">
      <div className="min-w-0">
        <div id={labelId} className="text-[13px] leading-[18px] font-medium text-ink">
          {label}
        </div>
        {hint && <p className="pg-t-caption mt-0.5">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A tiny console drawn in the preset's own palette. */
function PresetPreview({ preset }: { preset: Preset }) {
  const vars = useMemo(
    () => paletteVars(preset.family, preset.mode === "dark" ? "dark" : "light", null),
    [preset],
  );
  return (
    <div
      aria-hidden
      className="flex aspect-[16/10] w-full overflow-hidden border-b border-hairline bg-paper"
      style={{ ...(vars as CSSProperties), colorScheme: vars["--pg-color-scheme"] }}
    >
      <div className="flex w-[27%] flex-col gap-[5px] border-r border-hairline bg-surface p-[7px]">
        <span className="mb-[3px] block size-[10px] rounded-[3px] bg-brand" />
        <span className="block h-[5px] w-[80%] rounded-[2px] bg-brand-tint" />
        <span className="block h-[4px] w-[64%] rounded-[2px] bg-sunken" />
        <span className="block h-[4px] w-[72%] rounded-[2px] bg-sunken" />
        <span className="block h-[4px] w-[56%] rounded-[2px] bg-sunken" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[6px] p-[8px]">
        <div className="flex items-center justify-between">
          <span className="block h-[6px] w-[38%] rounded-[2px] bg-ink" />
          <span className="block h-[8px] w-[18%] rounded-[2px] bg-brand" />
        </div>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-hairline bg-hairline">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-[3px] bg-surface p-[5px]">
              <span className="block h-[3px] w-[60%] rounded-[1px] bg-ink-3 opacity-70" />
              <span className="block h-[6px] w-[45%] rounded-[1px] bg-ink" />
            </div>
          ))}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[3px] border border-hairline bg-surface">
          <svg
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full"
          >
            <rect
              x="0"
              y="14"
              width="100"
              height="10"
              fill="var(--pg-chart-target)"
              fillOpacity="0.12"
            />
            <polyline
              points="0,26 12,22 24,24 36,17 48,19 60,12 72,15 84,9 100,12"
              fill="none"
              stroke="var(--pg-chart-1)"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points="0,32 14,30 28,31 42,27 56,29 70,25 84,27 100,24"
              fill="none"
              stroke="var(--pg-chart-2)"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="absolute top-[5px] right-[5px] block h-[6px] w-[22%] rounded-[2px] bg-ok-tint" />
        </div>
      </div>
    </div>
  );
}

function PresetPicker() {
  const { settings, choosePreset } = useTheme();
  const customised = isCustomised(settings);
  return (
    <div
      role="radiogroup"
      aria-label="Theme preset"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
    >
      {PRESETS.map((p) => {
        const checked = settings.preset === p.id;
        return (
          <label
            key={p.id}
            className={cn(
              "group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-surface transition-colors",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--pg-focus)]",
              checked
                ? "border-brand ring-1 ring-brand"
                : "border-hairline hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name="pg-preset"
              value={p.id}
              checked={checked}
              onChange={() => choosePreset(p.id)}
              className="sr-only"
            />
            <PresetPreview preset={p} />
            <span className="flex items-start justify-between gap-2 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-[13px] leading-[18px] font-medium text-ink">
                  {p.name}
                  {checked && customised && (
                    <span className="font-normal text-ink-3"> · customised</span>
                  )}
                </span>
                <span className="mt-0.5 block text-[12px] leading-4 text-ink-3">
                  {p.description}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                  checked
                    ? "border-brand bg-brand text-[var(--pg-on-brand)]"
                    : "border-line-strong",
                )}
              >
                {checked && <Check className="size-3" strokeWidth={3} />}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function AccentPicker() {
  const { settings, scheme, update } = useTheme();
  const pal = FAMILIES[settings.family][scheme];
  const shown = (hex: string) => deriveBrand(hex, pal, scheme).brand;
  const familyAccent = pal.accentTint ? pal.accent : shown(pal.accent);
  const isPreset = (hex: string) => ACCENTS.some((a) => a.hex === hex);
  const custom = settings.accent && !isPreset(settings.accent) ? settings.accent : null;
  const actual = settings.accent ? shown(settings.accent) : null;
  const options = [
    {
      key: "default",
      name: `${FAMILIES[settings.family].name} default`,
      color: familyAccent,
      value: null as string | null,
    },
    // Skip a swatch that would look identical to the family default.
    ...ACCENTS.filter((a) => a.hex === settings.accent || shown(a.hex) !== familyAccent).map(
      (a) => ({
        key: a.hex,
        name: a.name,
        color: shown(a.hex),
        value: a.hex as string | null,
      }),
    ),
  ];
  const swatch =
    "relative inline-flex size-8 cursor-pointer items-center justify-center rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--pg-focus)]";
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Accent colour"
        className="flex flex-wrap items-center gap-2"
      >
        {options.map((o) => {
          const checked = settings.accent === o.value;
          return (
            <label key={o.key} title={o.name} className={swatch}>
              <input
                type="radio"
                name="pg-accent"
                checked={checked}
                onChange={() => update({ accent: o.value })}
                className="sr-only"
                aria-label={o.name}
              />
              <span
                aria-hidden
                className={cn(
                  "block size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]",
                  checked &&
                    "ring-2 ring-[var(--pg-ink)] ring-offset-2 ring-offset-[var(--pg-surface)]",
                )}
                style={{ background: o.color }}
              />
            </label>
          );
        })}
        <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
        <label title="Custom colour" className={swatch}>
          <input
            type="color"
            aria-label="Custom accent colour"
            value={custom ?? settings.accent ?? familyAccent}
            onChange={(e) => update({ accent: e.target.value.toLowerCase() })}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <span
            aria-hidden
            className={cn(
              "flex size-6 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-3",
              custom &&
                "border-solid ring-2 ring-[var(--pg-ink)] ring-offset-2 ring-offset-[var(--pg-surface)]",
            )}
            style={
              custom
                ? {
                    background: shown(custom),
                    borderColor: "transparent",
                    color: "var(--pg-on-brand)",
                  }
                : undefined
            }
          >
            <Pipette className="size-3.5" />
          </span>
        </label>
      </div>
      <p className="pg-t-caption mt-2" aria-live="polite">
        {settings.accent && actual && actual !== settings.accent.toLowerCase() ? (
          <>
            Picked <span className="pg-mono">{settings.accent}</span>, shown as{" "}
            <span className="pg-mono">{actual}</span> so text on it stays readable.
          </>
        ) : (
          "Hover and pressed shades are derived automatically."
        )}
      </p>
    </div>
  );
}

// Glyph subset for font previews (both temperature units).
const FONT_SAMPLE = "Aa 0123456789 °CF";

function FontPicker() {
  const { settings, update } = useTheme();
  // Load just the glyphs each option needs to render its own name.
  useEffect(() => {
    for (const f of Object.values(FONTS))
      if (f.css) ensureFontLink(fontUrl(f.css, f.name + FONT_SAMPLE));
  }, []);
  return (
    <div
      role="radiogroup"
      aria-label="Interface font"
      className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
    >
      {(Object.keys(FONTS) as FontId[]).map((id) => {
        const f = FONTS[id];
        const checked = settings.font === id;
        return (
          <label
            key={id}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--pg-focus)]",
              checked
                ? "border-brand bg-brand-tint"
                : "border-hairline bg-surface hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name="pg-font"
              checked={checked}
              onChange={() => update({ font: id })}
              className="mt-[3px] size-4 shrink-0 accent-[var(--pg-brand)]"
            />
            <span className="min-w-0" style={{ fontFamily: `"${f.family}", var(--pg-font-sans)` }}>
              <span className="block truncate text-[15px] leading-5 font-medium text-ink">
                {f.name}
              </span>
              <span className="block truncate text-[12px] leading-4 text-ink-3">{f.note}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function AppearanceSection() {
  const { settings, scheme, update, resetToPreset } = useTheme();
  const monoId = useId();
  const set =
    <K extends keyof ThemeSettings>(k: K) =>
    (v: ThemeSettings[K]) =>
      update({ [k]: v } as Partial<ThemeSettings>);

  useEffect(() => {
    for (const m of Object.values(MONO_FONTS))
      if (m.css) ensureFontLink(fontUrl(m.css, m.name + FONT_SAMPLE + "PG-ESP"));
  }, []);

  return (
    <Section
      id="appearance"
      title="Appearance"
      description="Saved in this browser for your account. Changes apply as you make them."
      action={
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={resetToPreset}>
          Reset to preset
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <PresetPicker />

        <Card padding="md">
          <div className="divide-y divide-hairline">
            <SettingRow
              label="Mode"
              hint={settings.mode === "system" ? `Following your device: ${scheme}.` : undefined}
            >
              <SegmentedControl
                ariaLabel="Mode"
                value={settings.mode}
                onChange={set("mode")}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
              />
            </SettingRow>
            <SettingRow label="Accent" hint="Buttons, active navigation, the first chart series.">
              <AccentPicker />
            </SettingRow>
            <SettingRow label="Background">
              <SegmentedControl
                ariaLabel="Background"
                value={settings.background}
                onChange={set("background")}
                options={[
                  { value: "plain", label: "Plain" },
                  { value: "texture", label: "Paper grain" },
                  { value: "tint", label: "Accent tint" },
                ]}
              />
            </SettingRow>
            <SettingRow label="Sidebar" hint="Ink keeps a dark rail in light themes.">
              <SegmentedControl
                ariaLabel="Sidebar"
                value={settings.sidebar}
                onChange={set("sidebar")}
                options={[
                  { value: "surface", label: "Panel" },
                  { value: "blend", label: "Blend" },
                  { value: "ink", label: "Ink" },
                ]}
              />
            </SettingRow>
            <SettingRow label="Interface font">
              <FontPicker />
            </SettingRow>
            <SettingRow
              label="Numbers font"
              hint="Big readings, device IDs and keys."
              labelId={`${monoId}-l`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Select
                  aria-labelledby={`${monoId}-l`}
                  className="w-full sm:w-56"
                  value={settings.mono}
                  onChange={(e) => update({ mono: e.target.value as MonoId })}
                >
                  {(Object.keys(MONO_FONTS) as MonoId[]).map((id) => (
                    <option key={id} value={id}>
                      {MONO_FONTS[id].name}
                    </option>
                  ))}
                </Select>
                <span className="pg-t-kpi-sm whitespace-nowrap" aria-hidden>
                  {formatNumber(toTemp(28.4))}
                  <span className="pg-unit">{tempUnit()}</span>
                  <span className="pg-mono ml-3 text-[13px] text-ink-3">PG-ESP32-07</span>
                </span>
              </div>
            </SettingRow>
            <SettingRow label="Density" hint="Compact fits more table rows on screen.">
              <SegmentedControl
                ariaLabel="Density"
                value={settings.density}
                onChange={set("density")}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
              />
            </SettingRow>
            <SettingRow label="Corners">
              <SegmentedControl
                ariaLabel="Corners"
                value={settings.radius}
                onChange={set("radius")}
                options={[
                  { value: "sharp", label: "Sharp" },
                  { value: "default", label: "Default" },
                  { value: "round", label: "Round" },
                ]}
              />
            </SettingRow>
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- *
 * Accessibility
 * -------------------------------------------------------------------------- */

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  on,
  off,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  on: string;
  off: string;
}) {
  const id = useId();
  return (
    <SettingRow label={label} hint={hint} labelId={`${id}-l`}>
      <div className="flex items-center gap-3">
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
        <label htmlFor={id} className="cursor-pointer text-[13px] leading-[18px] text-ink-2">
          {checked ? on : off}
        </label>
      </div>
    </SettingRow>
  );
}

function AccessibilitySection() {
  const { settings, update, choosePreset } = useTheme();
  const langId = useId();
  const set =
    <K extends keyof ThemeSettings>(k: K) =>
    (v: ThemeSettings[K]) =>
      update({ [k]: v } as Partial<ThemeSettings>);

  return (
    <Section
      id="accessibility"
      title="Accessibility"
      description="Make PoultryGrid easier to read, see, tap and hear. Saved for your account in this browser."
    >
      <div className="flex flex-col gap-4">
        <Card padding="md">
          <h3 className="pg-t-h3 mb-3">Reading</h3>
          <div className="divide-y divide-hairline">
            <SettingRow label="Text size" hint="Scales the whole console, like browser zoom.">
              <SegmentedControl
                ariaLabel="Text size"
                value={settings.textSize}
                onChange={set("textSize")}
                options={[
                  { value: "s", label: "Small" },
                  { value: "m", label: "Default" },
                  { value: "l", label: "Large" },
                  { value: "xl", label: "Extra large" },
                ]}
              />
            </SettingRow>
            <SettingRow
              label="Line spacing"
              hint="More room between lines and words. Helps with dyslexia and tired eyes."
            >
              <SegmentedControl
                ariaLabel="Line spacing"
                value={settings.spacing}
                onChange={set("spacing")}
                options={[
                  { value: "normal", label: "Normal" },
                  { value: "relaxed", label: "Relaxed" },
                ]}
              />
            </SettingRow>
            <SettingRow
              label="Most readable font"
              hint="Atkinson Hyperlegible was designed for low-vision readers."
            >
              {settings.font === "atkinson" ? (
                <p className="flex items-center gap-1.5 text-[13px] leading-[18px] text-ink-2">
                  <Check className="size-4 text-ok" aria-hidden /> In use
                </p>
              ) : (
                <Button size="sm" onClick={() => update({ font: "atkinson" })}>
                  Use Atkinson Hyperlegible
                </Button>
              )}
            </SettingRow>
            <ToggleRow
              label="Underline links"
              checked={settings.underlineLinks}
              onChange={set("underlineLinks")}
              on="Links are always underlined"
              off="Underlined on hover"
            />
          </div>
        </Card>

        <Card padding="md">
          <h3 className="pg-t-h3 mb-3">Seeing</h3>
          <div className="divide-y divide-hairline">
            <SettingRow
              label="High contrast"
              hint="Black and white with strong outlines. Replaces your colour theme."
            >
              {settings.preset === "contrast" ? (
                <p className="flex items-center gap-1.5 text-[13px] leading-[18px] text-ink-2">
                  <Check className="size-4 text-ok" aria-hidden /> In use. Pick another theme under
                  Appearance to switch back.
                </p>
              ) : (
                <Button size="sm" onClick={() => choosePreset("contrast")}>
                  Switch to high contrast
                </Button>
              )}
            </SettingRow>
            <SettingRow
              label="Status colours"
              hint="Colour-blind safe uses blue, orange and purple instead of green, amber and red."
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <SegmentedControl
                  ariaLabel="Status colours"
                  value={settings.statusColors}
                  onChange={set("statusColors")}
                  options={[
                    { value: "default", label: "Default" },
                    { value: "cvd", label: "Colour-blind safe" },
                  ]}
                />
                <span
                  className="flex items-center gap-3 text-[12px] leading-4 text-ink-2"
                  aria-hidden
                >
                  <span className="flex items-center gap-1.5">
                    <StatusDot status="ok" /> Fine
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot status="warn" /> Warning
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot status="crit" /> Critical
                  </span>
                </span>
              </div>
            </SettingRow>
            <ToggleRow
              label="Pause animated images"
              hint="Shows a still Ama instead of the moving one."
              checked={settings.stillImages}
              onChange={set("stillImages")}
              on="Animations paused"
              off="Ama moves"
            />
            <ToggleRow
              label="Reduce motion"
              hint="Off follows your device setting."
              checked={settings.motion === "reduce"}
              onChange={(v) => update({ motion: v ? "reduce" : "system" })}
              on="Animations off in the console"
              off="Following device"
            />
          </div>
        </Card>

        <Card padding="md">
          <h3 className="pg-t-h3 mb-3">Keyboard and touch</h3>
          <div className="divide-y divide-hairline">
            <SettingRow
              label="Focus outline"
              hint="The ring that shows where you are when using a keyboard or switch."
            >
              <SegmentedControl
                ariaLabel="Focus outline"
                value={settings.focus}
                onChange={set("focus")}
                options={[
                  { value: "default", label: "Default" },
                  { value: "strong", label: "Strong" },
                ]}
              />
            </SettingRow>
            <SettingRow
              label="Button size"
              hint="Large makes every button and field at least 44 px tall, easier to tap."
            >
              <SegmentedControl
                ariaLabel="Button size"
                value={settings.targets}
                onChange={set("targets")}
                options={[
                  { value: "default", label: "Default" },
                  { value: "large", label: "Large" },
                ]}
              />
            </SettingRow>
          </div>
        </Card>

        <Card padding="md">
          <h3 className="pg-t-h3 mb-3">Listening and speaking</h3>
          <div className="divide-y divide-hairline">
            <ToggleRow
              label="Read Ama’s replies aloud"
              hint="In the AI chat she speaks every answer. You can also tap Listen on any reply."
              checked={settings.aiSpeak}
              onChange={set("aiSpeak")}
              on="Ama speaks her replies"
              off="Text only"
            />
            <SettingRow
              label="Language you speak"
              hint="Helps Ama hear Twi, Ga, Ewe and Hausa correctly when you use the mic."
              labelId={`${langId}-l`}
            >
              <Select
                aria-labelledby={`${langId}-l`}
                className="w-full sm:w-56"
                value={settings.aiLang}
                onChange={(e) => update({ aiLang: e.target.value as AiLang })}
              >
                {SPEECH_LANGS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id === "auto" ? "Any language (auto-detect)" : l.native}
                  </option>
                ))}
              </Select>
            </SettingRow>
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- *
 * Preferences
 * -------------------------------------------------------------------------- */

function PreferencesSection() {
  const { settings, update } = useTheme();
  // Subscribes to the display store, so the examples update once ThemeProvider applies the change.
  useDisplayPrefs();
  // A fixed afternoon time so both options show the difference.
  const sample = useMemo(() => {
    const d = new Date();
    d.setHours(14, 20, 0, 0);
    return d;
  }, []);
  return (
    <Section id="preferences" title="Preferences">
      <Card padding="md">
        <div className="divide-y divide-hairline">
          <SettingRow label="Time format" hint="Used for every time in the console.">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <SegmentedControl
                ariaLabel="Time format"
                value={settings.clock}
                onChange={(v) => update({ clock: v })}
                options={[
                  { value: "24h", label: "24-hour" },
                  { value: "12h", label: "12-hour" },
                ]}
              />
              <span className="pg-t-caption pg-num">Example: {formatTime(sample)}</span>
            </div>
          </SettingRow>
          <SettingRow
            label="Temperature unit"
            hint="Used for every temperature in the console. Sensors and reports store °C."
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <SegmentedControl
                ariaLabel="Temperature unit"
                value={settings.tempUnit}
                onChange={(v) => update({ tempUnit: v })}
                options={[
                  { value: "C", label: "Celsius (°C)" },
                  { value: "F", label: "Fahrenheit (°F)" },
                ]}
              />
              <span className="pg-t-caption pg-num">Example: {formatTemp(28.2)}</span>
            </div>
          </SettingRow>
        </div>
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------------------- *
 * About this farm system (real data only)
 * -------------------------------------------------------------------------- */

function AboutSection() {
  const farms = useQuery({
    queryKey: ["farms-list"],
    queryFn: () => listFarms(),
    staleTime: 300_000,
  });
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => listDevices(),
    refetchInterval: 30_000,
  });
  const houses = useQuery({
    queryKey: ["profile-houses"],
    queryFn: () => listHouses(),
    staleTime: 60_000,
  });

  const loading = farms.isPending || devices.isPending || houses.isPending;
  const error = farms.error ?? devices.error ?? houses.error;

  const items: { label: ReactNode; value: ReactNode }[] = [];
  if (farms.data) {
    items.push({
      label: farms.data.length > 1 ? "Farms" : "Farm",
      value: farms.data.length ? (
        farms.data.map((f) => f.name).join(", ")
      ) : (
        <span className="text-ink-3">Not set up yet</span>
      ),
    });
  }
  if (houses.data) {
    const n = houses.data.houses.length;
    const birds = houses.data.houses.reduce((s, h) => s + (Number(h.bird_count) || 0), 0);
    items.push({
      label: "Houses",
      value: (
        <span className="pg-num">
          {n}
          {n > 0 && (
            <span className="text-ink-3">
              {" "}
              · {new Intl.NumberFormat("en-GB").format(birds)} birds
            </span>
          )}
        </span>
      ),
    });
  }
  if (devices.data) {
    const n = devices.data.length;
    const online = devices.data.filter((d) => d.online).length;
    items.push({
      label: "Devices",
      value: (
        <span className="pg-num">
          {n} registered
          {n > 0 && <span className="text-ink-3"> · {online} online</span>}
        </span>
      ),
    });
  }

  return (
    <Section id="about" title="This farm system">
      <Card padding="md">
        {loading ? (
          <SkeletonText lines={3} />
        ) : error && !items.length ? (
          <ErrorState
            title="Couldn't load farm details"
            error={error}
            onRetry={() => {
              void farms.refetch();
              void devices.refetch();
              void houses.refetch();
            }}
          />
        ) : (
          <DescList items={items} />
        )}
      </Card>
    </Section>
  );
}
