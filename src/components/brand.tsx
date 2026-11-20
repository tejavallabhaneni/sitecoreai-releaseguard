/* eslint-disable @next/next/no-img-element -- static SVG brand assets, nothing to optimise */

/**
 * Publish Guard mark + name, unchanged brand artwork: the halftone shield, "Publish" in
 * the logo navy and "Guard" in the pink → purple gradient. Then the "Content audit"
 * label beside it on wider screens (not part of the logo).
 */
export function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3.5">
      <img
        src="/branding/publish-guard-mark.svg"
        alt=""
        width={30}
        height={34}
        className="h-[26px] w-auto shrink-0 sm:h-[34px]"
      />
      <span className="pg-logo-navy hidden text-[17px] leading-none font-extrabold tracking-[-0.01em] whitespace-nowrap min-[480px]:inline sm:text-xl">
        Publish <span className="pg-gradient-text">Guard</span>
      </span>
      <span className="sr-only min-[480px]:hidden">Publish Guard</span>
      <span className="ml-1 hidden border-l border-line pl-3.5 text-[13px] whitespace-nowrap text-muted md:inline">Content audit</span>
    </div>
  );
}

/** The footer: copyright and the Sitecore trademark notice. */
export function AppFooter() {
  return (
    <footer className="shrink-0 border-t border-line bg-surface px-4 py-2 text-[12px] text-muted">
      © {new Date().getFullYear()} Teja Vallabhaneni. Sitecore® is a trademark of Sitecore Corporation A/S.
    </footer>
  );
}
