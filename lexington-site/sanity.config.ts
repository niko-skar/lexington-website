"use client";

import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";

import { apiVersion, dataset, projectId } from "./sanity/env";
import { schemaTypes, buyersSchemaTypes } from "./sanity/schemaTypes";
import { structure } from "./sanity/structure";
import { buyersStructure } from "./sanity/buyersStructure";

// Buyer accounts, payments and signed agreements live in a second,
// private dataset -- created separately in manage.sanity.io (a normal
// dataset name isn't sensitive, so this is safe as NEXT_PUBLIC_).
// Falls back to a plain default so this config never throws before
// that dataset exists; the "buyers" workspace just won't have real
// data to show until it's created and the env var is set.
const buyersDataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET || "buyers";

export default defineConfig([
  {
    name: "production",
    title: "The Lexington",
    basePath: "/studio",
    projectId,
    dataset,
    schema: { types: schemaTypes },
    plugins: [
      structureTool({ structure }),
      visionTool({ defaultApiVersion: apiVersion }),
    ],
  },
  {
    // Sanity requires every workspace's basePath to have the same number
    // of URL segments, so this can't nest under /studio/buyers (2
    // segments vs. /studio's 1) -- it's a sibling top-level path instead,
    // with its own catch-all route at app/buyers-studio/[[...tool]].
    name: "buyers",
    title: "Buyer Accounts",
    basePath: "/buyers-studio",
    projectId,
    dataset: buyersDataset,
    schema: { types: buyersSchemaTypes },
    plugins: [structureTool({ structure: buyersStructure })],
  },
]);
