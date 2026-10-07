"use client";

import { create } from "@orama/orama";
import { useDocsSearch } from "fumadocs-core/search/client";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";

import { docsBasePath } from "@/lib/site";

// app/api/search/route.ts builds the index with the Portuguese tokenizer, so
// the browser has to load it with the same one.
function initOrama() {
  return create({ schema: { _: "string" }, language: "portuguese" });
}

/** Search over the static index exported with the docs. */
export function DocsSearchDialog(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    type: "static",
    from: `${docsBasePath}/api/search`,
    initOrama,
  });

  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== "empty" ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
