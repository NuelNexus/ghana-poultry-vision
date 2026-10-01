import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Leaf } from "lucide-react";
import { toast } from "sonner";
import { signIn, signUp } from "@/lib/api/auth.functions";
import { useAuth } from "@/lib/auth";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (user) navigate({ to: "/app" }); }, [user, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        await signUp({ data: { email, password, fullName } });
        toast.success("Account created");
      } else {
        await signIn({ data: { email, password } });
        toast.success("Welcome back");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="auth-bg">
      <div className="auth-shell">
        <Link to="/" className="auth-brand">
          <div className="auth-logo">
            <Leaf className="auth-logo-icon" />
          </div>
          <span className="auth-brand-text">PoultryGrid AI</span>
        </Link>
        <div className="contact-us">
          <h1 className="auth-title">{mode === "signin" ? "Sign in" : "Create account"}</h1>
          <p className="auth-subtitle">
            {mode === "signin"
              ? "Access your farm dashboard."
              : "The first account becomes the farm admin; later accounts join as workers."}
          </p>
          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && (
              <>
                <Field label="Full name">
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} required
                    className="auth-input" placeholder="Full name" />
                </Field>
              </>
            )}
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="auth-input" placeholder="Email" />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 8 : 1}
                className="auth-input" placeholder="Password" />
            </Field>
            <button disabled={loading} type="submit" className="auth-button">
              {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
          <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="auth-toggle">
            {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
      <div className="rabbit-scene" aria-hidden="true">
        <div className="rabbit"></div>
        <div className="clouds"></div>
      </div>
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
