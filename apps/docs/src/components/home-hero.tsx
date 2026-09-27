import { Button } from "@tailorkit/ui/button";
import { cn } from "@tailorkit/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type RiveDefault from "@rive-app/react-webgl2";
import type { Layout } from "@rive-app/react-webgl2";

type RiveComponent = typeof RiveDefault;

function useRiveHero() {
  const [rive, setRive] = useState<{
    Component: RiveComponent;
    layout: Layout;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    import("@rive-app/react-webgl2").then((pkg) => {
      if (cancelled) {
        return;
      }

      const Component =
        (pkg.default as unknown as { default?: RiveComponent }).default ?? pkg.default;
      const layout = new pkg.Layout({
        fit: pkg.Fit.Contain,
        alignment: pkg.Alignment.TopRight,
      });

      setRive({ Component, layout });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return rive;
}

export function HomeHero() {
  const rive = useRiveHero();
  const riveClass =
    "absolute -top-6 right-0 h-[65%] w-[78%] sm:h-[60%] sm:w-[62%] lg:-top-12 lg:h-[75%] lg:w-[62%] transition-opacity duration-300";
  const Rive = rive?.Component;

  return (
    <section className="relative flex min-h-[540px] flex-col justify-end overflow-hidden bg-background border-b border-border sm:min-h-[600px] lg:min-h-[680px] lg:justify-center xl:min-h-[740px]">
      {Rive ? (
        <>
          <Rive
            className={cn(riveClass, "opacity-100 dark:opacity-0")}
            src="/docs/factory-light.riv"
            layout={rive.layout}
          />
          <Rive
            className={cn(riveClass, "opacity-0 dark:opacity-100")}
            src="/docs/factory-dark.riv"
            layout={rive.layout}
          />
        </>
      ) : null}

      <div className="relative z-10 flex max-w-2xl flex-col items-start gap-5 px-6 pb-12 pt-6 sm:max-w-[34rem] lg:max-w-2xl lg:px-14 lg:py-0">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-foreground text-[2.75rem] leading-tight tracking-tight min-[375px]:text-[3.5rem] min-[375px]:leading-[1.05] md:text-6xl lg:text-balance lg:text-[5rem] lg:leading-[1.05]">
            Let
            <br className="lg:hidden" /> users build
            <br className="lg:hidden" /> the features they want
          </h1>
          <p className="text-sm/6 sm:text-base/7 text-foreground/60 text-pretty">
            TailorKit gives your SaaS an <span className="text-foreground">app ecosystem</span>,
            with <span className="text-foreground">hosting</span>,{" "}
            <span className="text-foreground">sandboxing</span>, and{" "}
            <span className="text-foreground">agentic builders</span> so customers and partners can
            easily extend your product using your{" "}
            <span className="text-foreground">design system</span>.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 sm:gap-4">
          <Button
            variant="default"
            render={
              <a href="https://cal.com/alfiejones" rel="noopener noreferrer">
                Talk to a Founder
              </a>
            }
          />
          <Button variant="secondary" render={<Link to="/docs/$">Read the docs</Link>} />
        </div>
      </div>
    </section>
  );
}
