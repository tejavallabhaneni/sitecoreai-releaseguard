import { ReleaseGuard } from "@/components/release-guard";

/** Extension-point route for SitecoreAI (full-screen). Same app; the iframe decides the mode. */
export default function SitecorePage() {
  return <ReleaseGuard />;
}
