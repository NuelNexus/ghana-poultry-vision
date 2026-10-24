import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Leaf } from "lucide-react";
import { toast } from "sonner";
import { signIn, signUp } from "@/lib/api/auth.functions";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/components/LanguageProvider";
import { LanguagePicker } from "@/components/LanguagePicker";
import { HatchLoop } from "@/components/HatchLoop";

const search = z.object({
  mode: z.enum(["signin", "signup"]).optional().default("signin"),
});

export const Route = createFileRoute("/login")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Sign in — PoultryGrid AI" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { mode: initial } = Route.useSearch();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">(initial);
  // Sign-up starts by choosing a language, so the rest of the form is in it.
  const [step, setStep] = useState<"lang" | "form">(initial === "signup" ? "lang" : "form");
  const { lang } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/app" });
  }, [user, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        await signUp({ data: { email, password, fullName, language: lang } });
        toast.success("Account created");
      } else {
        await signIn({ data: { email, password } });
        toast.success("Welcome back");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-shell">
        <Link to="/" className="auth-brand">
          <div className="auth-logo">
            <Leaf className="auth-logo-icon" />
          </div>
          <span className="auth-brand-text" translate="no">
            PoultryGrid AI
          </span>
        </Link>
        <div className="contact-us">
          {mode === "signup" && step === "lang" ? (
            <>
              <h1 className="auth-title">Choose your language</h1>
              <p className="auth-subtitle">
                Tap your language to hear it. The whole site will use it. You can change it later in
                Profile.
              </p>
              <div className="mt-6 mb-8">
                <LanguagePicker />
              </div>
              <button type="button" className="auth-button" onClick={() => setStep("form")}>
                Continue
              </button>
              <button onClick={() => setMode("signin")} className="auth-toggle">
                Already have an account? Sign in
              </button>
            </>
          ) : (
            <>
              {mode === "signin" && (
                <div className="mb-5">
                  <LanguagePicker variant="chips" />
                </div>
              )}
              <h1 className="auth-title">{mode === "signin" ? "Sign in" : "Create account"}</h1>
              <p className="auth-subtitle">
                {mode === "signin"
                  ? "Access your farm dashboard."
                  : "Your account gets its own farm. Devices and data you add are only visible to you."}
              </p>
              <form onSubmit={submit} className="auth-form">
                {mode === "signup" && (
                  <>
                    <Field label="Full name">
                      <input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        className="auth-input"
                        placeholder="Full name"
                      />
                    </Field>
                  </>
                )}
                <Field label="Email">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="auth-input"
                    placeholder="Email"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={mode === "signup" ? 8 : 1}
                    className="auth-input"
                    placeholder="Password"
                  />
                </Field>
                <button disabled={loading} type="submit" className="auth-button">
                  {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
                </button>
              </form>
              <button
                onClick={() => {
                  const next = mode === "signin" ? "signup" : "signin";
                  setMode(next);
                  if (next === "signup") setStep("lang");
                }}
                className="auth-toggle"
              >
                {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
              </button>
            </>
          )}
        </div>
      </div>
      <HatchLoop />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="auth-field">
      <span className="auth-label">{label}</span>
      <div className="auth-control">{children}</div>
    </label>
  );
}
