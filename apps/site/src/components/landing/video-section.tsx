"use client";

import { useState } from "react";
import Image from "next/image";

import { track } from "@/lib/analytics/track";

import { Reveal } from "./reveal";
import { SectionHeading } from "./landing-primitives";

// Institutional video, one render per theme. Nothing is downloaded until the
// visitor presses play: the facade is a poster image, and the matching source
// is picked at click time from the theme active in that moment.
const VIDEO_SRC = {
  light: "https://cdn.calibrafacil.com/site/institucional-light.mp4",
  dark: "https://cdn.calibrafacil.com/site/institucional-dark.mp4",
};

const POSTER = {
  light: "/landing/video-poster.webp",
  dark: "/landing/video-poster-dark.webp",
};

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-7 translate-x-[2px]">
      <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
    </svg>
  );
}

export function VideoSection() {
  const [video, setVideo] = useState<{ src: string; poster: string } | null>(
    null,
  );

  const startPlayback = () => {
    const dark = document.documentElement.classList.contains("dark");
    setVideo({
      src: dark ? VIDEO_SRC.dark : VIDEO_SRC.light,
      poster: dark ? POSTER.dark : POSTER.light,
    });
    track("video_play", {
      location: "landing_video",
      theme: dark ? "dark" : "light",
    });
  };

  return (
    <section
      id="video"
      className="relative isolate border-t border-border/70 py-24"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/3 mx-auto h-[420px] max-w-[1100px] bg-[radial-gradient(ellipse_70%_55%_at_50%_50%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          center
          title="Como funciona, em 90 segundos."
          lead="O caminho de uma calibração dentro do CalibraFácil: da ordem de serviço ao certificado assinado, pronto no portal do cliente."
        />

        <Reveal delay={0.08}>
          <div className="mx-auto max-w-[1000px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/10 ring-1 ring-black/[0.04] dark:shadow-black/40 dark:ring-white/[0.04]">
            {video ? (
              <video
                src={video.src}
                poster={video.poster}
                controls
                autoPlay
                playsInline
                preload="auto"
                className="aspect-video w-full"
              >
                Seu navegador não consegue reproduzir este vídeo.
              </video>
            ) : (
              <button
                type="button"
                onClick={startPlayback}
                aria-label="Assistir ao vídeo: da OS ao certificado em 90 segundos"
                className="group relative block aspect-video w-full cursor-pointer text-left"
              >
                <Image
                  src={POSTER.light}
                  alt=""
                  width={1920}
                  height={1080}
                  sizes="(min-width: 1000px) 936px, 100vw"
                  draggable={false}
                  className="block h-full w-full select-none object-cover dark:hidden"
                />
                <Image
                  src={POSTER.dark}
                  alt=""
                  width={1920}
                  height={1080}
                  sizes="(min-width: 1000px) 936px, 100vw"
                  draggable={false}
                  className="hidden h-full w-full select-none object-cover dark:block"
                />

                {/* Soft vignette so the play button reads on any poster. */}
                <span
                  aria-hidden
                  className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/[0.04] dark:group-hover:bg-white/[0.03]"
                />

                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex size-20 items-center justify-center rounded-full bg-gradient-to-b from-[#4f46e5] to-[#1447e6] text-white shadow-lg shadow-[#1447e6]/30 ring-8 ring-primary/10 transition-transform duration-300 ease-out group-hover:scale-105 motion-reduce:transition-none">
                    <PlayIcon />
                  </span>
                </span>

                <span className="absolute bottom-4 left-4 rounded-md bg-background/80 px-2.5 py-1 font-mono text-xs text-muted-foreground backdrop-blur-sm">
                  1:32 · com legendas
                </span>
              </button>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
