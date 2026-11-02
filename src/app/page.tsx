import { Desktop } from "@/components/desktop";
import { LoginForm } from "@/components/login-form";
import { authConfig } from "@/lib/auth";
import { loadServices, toPublic } from "@/lib/services";
import { isSignedIn } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!authConfig()) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-md space-y-3">
          <h1 className="display text-4xl">House of Stix</h1>
          <p className="text-mute">
            The control room is closed until it has a password. Set <code className="text-paper">HOUSE_PASSWORD</code> (8+ characters) and{" "}
            <code className="text-paper">HOUSE_SECRET</code> (32+ random characters) in <code className="text-paper">.env</code>, then restart it.
          </p>
        </div>
      </main>
    );
  }
  if (!(await isSignedIn())) return <LoginForm />;

  let services;
  try {
    services = loadServices().map(toPublic);
  } catch (e) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-xl space-y-3">
          <h1 className="display text-4xl">services.yaml has a problem</h1>
          <p className="text-down" role="alert">
            {e instanceof Error ? e.message : "Couldn't read the services file."}
          </p>
        </div>
      </main>
    );
  }
  return <Desktop services={services} />;
}
