import { Button } from "@tailorkit/ui/button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight } from "lucide-react";
import { Footer } from "#components/footer";
import { HomeCTA } from "#components/home-cta";
import { SiteNavbar } from "#components/site-navbar";
import { productFeatures } from "#lib/features";
import { baseOptions } from "#lib/layout.shared";

export const Route = createFileRoute("/home")({
  component: HomePage,
  head: homeHead,
});

export function homeHead() {
  return {
    links: [{ href: "https://tailorkit.dev/", rel: "canonical" }],
    meta: [
      { title: "TailorKit — An extension platform for your SaaS" },
      {
        content: "Let users build the features they want with AI, safely inside your SaaS.",
        name: "description",
      },
    ],
  };
}

export function HomePage() {
  const base = baseOptions();

  return (
    <HomeLayout {...base} nav={{ ...base.nav, component: <SiteNavbar /> }}>
      <main className="min-h-screen bg-sidebar text-foreground">
        <div className="mx-auto w-full max-w-7xl border-x border-border bg-background">
          <Hero />
          <FeatureGrid />
          <div className="border-t border-border">
            <HomeCTA />
          </div>
          <Footer />
        </div>
      </main>
    </HomeLayout>
  );
}

function Hero() {
  return (
    <section className="border-b border-border px-6 py-16 sm:px-10 sm:py-20 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <h1 className="max-w-[52rem] text-balance font-sans text-[clamp(2.75rem,6vw,5.5rem)] font-semibold leading-[1.05] tracking-[-0.045em]">
          Let users build the features they want <span className="text-primary">with AI.</span>
        </h1>
        <div className="mt-10 max-w-xl">
          <p className="text-pretty text-lg leading-8 text-foreground/62">
            TailorKit lets users, AI, and partners build extensions inside your SaaS. Those
            extensions run in a sandbox and use the components, data, and actions you choose to
            expose.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              size="lg"
              render={
                <a href="https://cal.com/alfiejones" rel="noopener noreferrer">
                  Talk to a founder <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </a>
              }
            />
            <Button size="lg" variant="outline" render={<Link to="/docs">Read the docs</Link>} />
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  return (
    <section className="px-4 py-9 sm:py-10">
      <div className="mx-auto w-full">
        <div className="grid overflow-hidden border-x border-border md:grid-cols-2 lg:grid-cols-4">
          {productFeatures.map((feature) => (
            <FeatureCard feature={feature} key={feature.title} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: (typeof productFeatures)[number] }) {
  const Icon = feature.icon;
  return (
    <article className="group relative flex min-h-60 flex-col border-b border-border p-11 text-left before:absolute before:top-[6.25rem] before:left-0 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r-sm before:bg-foreground/20 before:transition-[width,height,background-color] before:duration-300 before:ease-out hover:bg-linear-to-b hover:from-sidebar hover:to-background hover:before:h-10 hover:before:w-1 hover:before:bg-primary/50 motion-reduce:before:transition-none [&:last-child]:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 md:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(4n)]:border-r-0 lg:[&:nth-last-child(-n+4)]:border-b-0">
      <Icon aria-hidden="true" className="size-5 text-foreground/65" strokeWidth={2.25} />
      <div className="mt-6">
        <h3 className="max-w-56 text-lg font-semibold leading-[1.35] tracking-[-0.025em]">
          {feature.title}
        </h3>
        <p className="mt-3 max-w-60 text-sm leading-5 text-foreground/70">{feature.description}</p>
      </div>
    </article>
  );
}
