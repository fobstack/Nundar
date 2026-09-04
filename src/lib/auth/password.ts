/**
 * 密码哈希：WebCrypto 的 PBKDF2-SHA256。
 *
 * 选它而非 Argon2id 的原因是零依赖——Argon2 在 Workers 上需要引入 WASM 库，
 * 而本项目要作为开源模板发布，依赖越少越好。PBKDF2 配合足够的迭代次数与
 * 登录限流，对后台账号这一低频、少量账户的场景是够用的。
 *
 * 迭代次数取 210k（OWASP 对 PBKDF2-HMAC-SHA256 的推荐量级之一）。再高会显著
 * 增加单次登录的 CPU 时间，在 Workers 的 CPU 限额下得不偿失。
 */
const SCHEME = "pbkdf2-sha256";
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );

  return new Uint8Array(bits);
}

/** 比较两个等长字节串，耗时与内容无关，避免计时侧信道 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** 返回自描述的哈希串：scheme$iterations$salt$digest */
export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error("Password must not be empty");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await derive(password, salt, ITERATIONS);

  return [SCHEME, ITERATIONS, toBase64(salt), toBase64(digest)].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    // 存储格式不认识就是验证失败，不抛异常——避免把存储细节暴露成 500
    return false;
  }

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  try {
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    const actual = await derive(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 存量哈希是否该在下次成功登录时按当前参数重算 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    return true;
  }
  return Number(parts[1]) < ITERATIONS;
}
