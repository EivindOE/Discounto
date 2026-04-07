import type { DiscountKind } from "@prisma/client";
import type { SelectedProductInput } from "../models/discount.server";

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
