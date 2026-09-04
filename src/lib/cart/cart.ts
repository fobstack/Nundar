export type CartLine = {
  variantId: string;
  quantity: number;
};

export const CART_TTL_SECONDS = 60 * 60 * 24 * 30;

/** 单行数量上限：正常订单不会到这个量级，超过只可能是脚本刷单 */
const MAX_LINE_QUANTITY = 10_000;

const KEY_PREFIX = "cart:";

/** 购物车 id 必须不可猜测——它是拿到别人购物车内容的唯一凭据 */
export function newCartId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isValidLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const line = value as Partial<CartLine>;
  return (
    typeof line.variantId === "string" &&
    line.variantId.length > 0 &&
    Number.isInteger(line.quantity) &&
    (line.quantity as number) > 0
  );
}

/**
 * 读购物车。
 *
 * 存的只有 variantId 与数量，**绝不存价格**——价格永远在结账时按 D1 当前数据
 * 重算，否则前端可以把价格改成任意值提交。
 */
export async function readCart(
  kv: KVNamespace,
  cartId: string,
): Promise<CartLine[]> {
  if (!cartId) {
    return [];
  }

  const raw = await kv.get(`${KEY_PREFIX}${cartId}`);
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    // 脏数据丢弃即可，不该让整个购物车页面报错
    return parsed.filter(isValidLine).map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
    }));
  } catch {
    return [];
  }
}

async function writeCart(
  kv: KVNamespace,
  cartId: string,
  lines: CartLine[],
): Promise<void> {
  if (lines.length === 0) {
    await kv.delete(`${KEY_PREFIX}${cartId}`);
    return;
  }

  await kv.put(`${KEY_PREFIX}${cartId}`, JSON.stringify(lines), {
    expirationTtl: CART_TTL_SECONDS,
  });
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  if (quantity > MAX_LINE_QUANTITY) {
    throw new Error(`Quantity must not exceed ${MAX_LINE_QUANTITY}`);
  }
}

export async function addToCart(
  kv: KVNamespace,
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<CartLine[]> {
  assertQuantity(quantity);

  const lines = await readCart(kv, cartId);
  const existing = lines.find((line) => line.variantId === variantId);

  if (existing) {
    assertQuantity(existing.quantity + quantity);
    existing.quantity += quantity;
  } else {
    lines.push({ variantId, quantity });
  }

  await writeCart(kv, cartId, lines);
  return lines;
}

export async function setCartQuantity(
  kv: KVNamespace,
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<CartLine[]> {
  if (quantity === 0) {
    return removeFromCart(kv, cartId, variantId);
  }
  assertQuantity(quantity);

  const lines = await readCart(kv, cartId);
  const existing = lines.find((line) => line.variantId === variantId);

  if (existing) {
    existing.quantity = quantity;
  } else {
    lines.push({ variantId, quantity });
  }

  await writeCart(kv, cartId, lines);
  return lines;
}

export async function removeFromCart(
  kv: KVNamespace,
  cartId: string,
  variantId: string,
): Promise<CartLine[]> {
  const lines = (await readCart(kv, cartId)).filter(
    (line) => line.variantId !== variantId,
  );
  await writeCart(kv, cartId, lines);
  return lines;
}

export async function clearCart(
  kv: KVNamespace,
  cartId: string,
): Promise<void> {
  await kv.delete(`${KEY_PREFIX}${cartId}`);
}
