import { buttonVariants } from "@tailorkit/ui/button";
import { Link } from "@tanstack/react-router";

export function HomeCTA() {
  return (
    <section className="flex flex-col items-center gap-8 px-6 py-20 text-center lg:py-32">
      <div className="flex flex-col gap-4 max-w-3xl">
        <h2 className="font-display text-foreground text-4xl leading-tight tracking-tight text-balance sm:text-5xl lg:text-[4rem] lg:leading-[1.05]">
          Ready to give your users a superpower?
        </h2>
        <p className="text-base/7 text-foreground/60 text-pretty max-w-xl mx-auto">
          We work directly with early teams. Hop on a call and we'll get a prototype inside your
          product.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
        <a className={buttonVariants()} href="https://cal.com/alfiejones" rel="noopener noreferrer">
          Talk to a Founder
        </a>
        <Link className={buttonVariants({ variant: "secondary" })} to="/docs/$">
          Read the docs
        </Link>
      </div>
    </section>
  );
}
