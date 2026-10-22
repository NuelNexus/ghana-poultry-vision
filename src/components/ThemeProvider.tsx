import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  BOOT_KEY,
  BOOT_SCRIPT,
  DEFAULT_SETTINGS,
  applyTheme,
  bootSnapshot,
  clearTheme,
  computeTheme,
  presetSettings,
  readJSON,
  sanitize,
  userKey,
  writeJSON,
  type PresetId,
  type Scheme,
  type ThemeSettings,
} from "@/lib/theme";
import { setClockFormat, setTempUnit } from "@/components/ui-kit";

interface ThemeCtx {
  settings: ThemeSettings;
  scheme: Scheme;
  update: (patch: Partial<ThemeSettings>) => void;
  choosePreset: (id: PresetId) => void;
  /** Back to the current preset's colours and default type/layout. */
  resetToPreset: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used inside <ThemeProvider>");
  return v;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function usePrefersDark() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(DARK_QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
}

/** Last settings used on this device (any account): what the boot script painted. */
function readBootSettings(): ThemeSettings | null {
  const raw = readJSON(`${BOOT_KEY}:settings`);
  return raw ? sanitize(raw) : null;
}

function readUserSettings(userId: string | null): ThemeSettings | null {
  if (!userId) return null;
  const raw = readJSON(userKey(userId));
  return raw ? sanitize(raw) : null;
}

/**
 * Applies the console theme to <html> while /app is mounted and removes it on
 * the way out (the landing and login pages never see it). Settings are kept
 * per user in localStorage and synced across tabs.
 */
export function ThemeProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  const prefersDark = usePrefersDark();
  // Hydration-safe: start from defaults; the boot script already painted the
  // stored theme, and the layout effect below swaps in the real settings
  // before the browser paints React's first commit.
  const [state, setState] = useState<{ owner: string | null; settings: ThemeSettings }>({
    owner: null,
    settings: DEFAULT_SETTINGS,
  });
  const [ready, setReady] = useState(false);

  // Resolve which settings to show: the signed-in user's, else this device's last.
  useLayoutEffect(() => {
    const s = readUserSettings(userId) ?? readBootSettings() ?? DEFAULT_SETTINGS;
    setState({ owner: userId, settings: s });
    setReady(true);
  }, [userId]);

  const settings = state.settings;
  const theme = useMemo(() => computeTheme(settings, prefersDark), [settings, prefersDark]);

  useLayoutEffect(() => {
    if (!ready) return;
    applyTheme(theme);
    setClockFormat(settings.clock);
    setTempUnit(settings.tempUnit);
  }, [theme, settings.clock, settings.tempUnit, ready]);

  // Leaving /app: hand <html> back untouched.
  useEffect(() => () => clearTheme(), []);

  // Other tabs: pick up changes to this user's settings.
  useEffect(() => {
    if (!userId) return;
    const key = userKey(userId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return;
      try {
        setState({ owner: userId, settings: sanitize(JSON.parse(e.newValue)) });
      } catch {
        /* ignore malformed writes */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  const persist = useCallback(
    (next: ThemeSettings) => {
      if (userId) writeJSON(userKey(userId), next);
      writeJSON(`${BOOT_KEY}:settings`, next);
      writeJSON(BOOT_KEY, bootSnapshot(next));
    },
    [userId],
  );

  const commit = useCallback(
    (fn: (prev: ThemeSettings) => ThemeSettings) => {
      setState((prev) => {
        const next = sanitize(fn(prev.settings));
        persist(next);
        return { owner: prev.owner, settings: next };
      });
    },
    [persist],
  );

  const value = useMemo<ThemeCtx>(
    () => ({
      settings,
      scheme: theme.scheme,
      update: (patch) => commit((prev) => ({ ...prev, ...patch })),
      choosePreset: (id) => commit((prev) => ({ ...prev, ...presetSettings(id) })),
      resetToPreset: () =>
        commit((prev) => ({
          ...DEFAULT_SETTINGS,
          ...presetSettings(prev.preset),
          clock: prev.clock,
          tempUnit: prev.tempUnit,
        })),
    }),
    [settings, theme.scheme, commit],
  );

  return (
    <Ctx.Provider value={value}>
      <script
        // Runs during SSR HTML parsing only (React doesn't execute it on the client).
        dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }}
        suppressHydrationWarning
      />
      {children}
    </Ctx.Provider>
  );
}
