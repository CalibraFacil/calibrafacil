import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";
import { site } from "./site";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold">
          <Image
            src="/logo-mark-light.svg"
            alt=""
            width={24}
            height={24}
            className="dark:hidden"
          />
          <Image
            src="/logo-mark-dark.svg"
            alt=""
            width={24}
            height={24}
            className="hidden dark:block"
          />
          {site.name}
        </span>
      ),
      url: "/",
    },
    links: [
      { text: "Projeto", url: site.productUrl, external: true },
      { text: "GitHub", url: site.repositoryUrl, external: true },
    ],
  };
}
