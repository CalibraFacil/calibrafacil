"use client";

import { useState } from "react";
import Image from "next/image";

import { track } from "@/lib/analytics/track";

// Product film. No video bytes are downloaded until the visitor presses
// play: the facade is a poster image and the video element mounts on click.
const VIDEO_SRC = "/landing/calibra-facil.mp4";
const POSTER = "/landing/calibra-facil-poster.jpg";

function isDark() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-6 translate-x-px">
      <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
    </svg>
  );
}

export function VideoSection() {
  const [playing, setPlaying] = useState(false);

  const startPlayback = () => {
    const dark = isDark();
    setPlaying(true);
    track("video_play", {
      location: "landing_video",
      theme: dark ? "dark" : "light",
    });
  };

  return (
    <section id="video" className="py-24 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <div className="mx-auto max-w-[640px] text-center">
          <h2 className="text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.028em] text-balance text-foreground">
            Seu laboratório em sintonia, em 45 segundos.
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-[17px] leading-relaxed text-muted-foreground">
            Da ordem de serviço ao certificado assinado no portal do cliente, em
            uma visão do fluxo CalibraFácil.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-[1000px] overflow-hidden rounded-2xl border border-border bg-card shadow-[0_2px_6px_rgba(15,23,42,0.04),0_40px_80px_-32px_rgba(15,23,42,0.28)]">
          {playing ? (
            <video
              src={VIDEO_SRC}
              poster={POSTER}
              controls
              autoPlay
              playsInline
              preload="auto"
              className="aspect-video w-full bg-black"
            >
              Seu navegador não consegue reproduzir este vídeo.
            </video>
          ) : (
            <button
              type="button"
              onClick={startPlayback}
              aria-label="Assistir ao vídeo: da ordem de serviço ao certificado, em 45 segundos"
              className="group relative block aspect-video w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
            >
              <Image
                src={POSTER}
                alt=""
                width={1920}
                height={1080}
                sizes="(min-width: 1000px) 1000px, 100vw"
                draggable={false}
                className="block h-full w-full select-none object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-[linear-gradient(180deg,#5b53ea,#3f3ad6)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_28px_-8px_rgba(79,70,229,0.6)] transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transition-none">
                  <PlayIcon />
                </span>
              </span>
              <span className="absolute bottom-3 left-3 rounded-md bg-card/90 px-2 py-1 text-[11.5px] text-muted-foreground backdrop-blur-sm">
                0:45 · apresentação narrada
              </span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
