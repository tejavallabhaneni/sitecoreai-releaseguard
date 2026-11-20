"use client";

import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeReport, tokenFromHash, type ReportFile } from "@/lib/report-link";
import { downloadText } from "@/lib/audit/summary";
import { BrandLockup } from "./brand";
import { Button, Card } from "./ui";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; file: ReportFile };

/**
 * The page Publish Guard opens in a new tab to save a report. It runs outside Sitecore's sandboxed
 * frame, so the browser lets it download the file. The report arrives in the URL fragment and is
 * removed from the address bar as soon as it has been read.
 */
export function ExportDownload() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const save = useCallback((file: ReportFile) => downloadText(file.name, file.text, file.type), []);
  // Read once: the effect may run twice in development, after the fragment is already cleared.
  const token = useRef<string | null>(null);

  useEffect(() => {
    if (token.current === null) token.current = tokenFromHash(window.location.hash);
    const value = token.current;
    // Keep the report out of the address bar and the history entry.
    window.history.replaceState(null, "", window.location.pathname);
    let cancelled = false;
    (async () => {
      if (!value) {
        if (!cancelled) setState({ kind: "error", message: "This link does not hold a report. Export it from Publish Guard." });
        return;
      }
      try {
        const file = await decodeReport(value);
        if (cancelled) return;
        setState({ kind: "ready", file });
        save(file);
      } catch (error) {
        if (!cancelled) setState({ kind: "error", message: (error as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [save]);

  return (
    <main className="flex flex-1 items-center justify-center overflow-y-auto bg-canvas p-6">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mb-4 flex justify-center">
          <BrandLockup />
        </div>
        {state.kind === "loading" ? (
          <p className="flex items-center justify-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Preparing your report…
          </p>
        ) : state.kind === "error" ? (
          <p className="flex items-start gap-2 text-left text-sm text-error">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {state.message}
          </p>
        ) : (
          <>
            <CheckCircle2 className="mx-auto mb-2 size-8 text-success" />
            <h1 className="text-base font-semibold text-navy">Your report is downloading</h1>
            <p className="mt-1 text-sm break-all text-muted">{state.file.name}</p>
            <p className="mt-3 text-[13px] text-ink/80">
              If it did not start, use the button. You can close this tab afterwards.
            </p>
            <Button variant="primary" className="mt-4" onClick={() => save(state.file)}>
              <Download className="size-3.5" /> Download again
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
