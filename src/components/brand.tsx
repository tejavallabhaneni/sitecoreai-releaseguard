/* eslint-disable @next/next/no-img-element -- static SVG brand assets, nothing to optimise */

/**
 * americaneagle.com logo | divider | Publish Guard mark + name — the same lockup as
 * Content Transfer by AE. The name is live text: "Publish" navy, "Guard" in the
 * pink → purple gradient.
 */
export function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3.5">
      <img
        src="/branding/americaneagle-logo.svg"
        alt="Americaneagle.com"
        width={221}
        height={34}
        className="h-[22px] w-auto shrink-0 sm:h-[30px]"
      />
      <span aria-hidden className="h-6 w-px shrink-0 bg-line-strong sm:h-7" />
      <img
        src="/branding/publish-guard-mark.svg"
        alt=""
        width={30}
        height={34}
        className="h-[26px] w-auto shrink-0 sm:h-[34px]"
      />
      <span className="hidden text-[17px] leading-none font-extrabold tracking-[-0.01em] whitespace-nowrap text-navy min-[480px]:inline sm:text-xl">
        Publish <span className="ae-gradient-text">Guard</span>
      </span>
      <span className="sr-only min-[480px]:hidden">Publish Guard</span>
    </div>
  );
}

/** The navy footer: copyright and the Sitecore trademark notice. */
export function AppFooter() {
  return (
    <footer className="shrink-0 bg-navy px-4 py-2.5 text-[12px] text-[#dfe7ef]">
      © {new Date().getFullYear()} Americaneagle.com. All rights reserved. Sitecore® is a trademark of Sitecore
      Corporation A/S.
    </footer>
  );
}
