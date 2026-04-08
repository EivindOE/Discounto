import type { DiscountKind } from "@prisma/client";
import type {
  SelectedCollectionInput,
  SelectedProductInput,
} from "../models/discount.server";

export function parseSelectedProducts(value: FormDataEntryValue | null): SelectedProductInput[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed)) {
    return [];
  }

  const normalizedProducts: SelectedProductInput[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const product = item as Record<string, unknown>;
    const productGid =
      typeof product.productGid === "string" ? product.productGid.trim() : "";

    if (!productGid) {
      continue;
    }

    normalizedProducts.push({
      productGid,
      productTitle:
        typeof product.productTitle === "string" ? product.productTitle : null,
      productHandle:
        typeof product.productHandle === "string" ? product.productHandle : null,
      imageUrl: typeof product.imageUrl === "string" ? product.imageUrl : null,
    });
  }

  return normalizedProducts;
}

export function parseSelectedCollections(
  value: FormDataEntryValue | null,
): SelectedCollectionInput[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed)) {
    return [];
  }

  const normalizedCollections: SelectedCollectionInput[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const collection = item as Record<string, unknown>;
    const collectionGid =
      typeof collection.collectionGid === "string" ? collection.collectionGid.trim() : "";

    if (!collectionGid) {
      continue;
    }

    normalizedCollections.push({
      collectionGid,
      collectionTitle:
        typeof collection.collectionTitle === "string" ? collection.collectionTitle : null,
      collectionHandle:
        typeof collection.collectionHandle === "string" ? collection.collectionHandle : null,
      imageUrl: typeof collection.imageUrl === "string" ? collection.imageUrl : null,
    });
  }

  return normalizedCollections;
}

export function parseOptionalIsoDate(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeDiscountKind(value: FormDataEntryValue | null): DiscountKind {
  return String(value ?? "") === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
}
