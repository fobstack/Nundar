import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "@/db/client";
import { SITE } from "@/config/site";
import { getSetting } from "@/lib/settings/settings";

/**
 * `/.well-known/security.txt` — RFC 9116.
 *
 * This is where security researchers and automated scanners look for a way to
 * report a vulnerability. A repository's SECURITY.md is read by people who are
 * already on GitHub; someone who finds a flaw by probing the live site is not,
 * and without this file their next move is a public disclosure or nothing.
 *
 * Served from the database rather than baked in, because the address is a
 * deployment's own — every fork has a different one, and asking an adopter to
 * edit a source file to publish theirs guarantees they will not.
 *
 * 404 when no address is configured. Publishing a file that names nobody is
 * worse than publishing none: it spends a researcher's goodwill before they
 * give up.
 */
export const dynamic = "force-dynamic";

function expiryIso(now: Date): string {
  // RFC 9116 requires an Expires field and warns against dates far in the
  // future. One year, recomputed on each request, keeps it perpetually valid
  // without anyone having to remember to update it.
  const expires = new Date(now);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function GET() {
  const { env } = getCloudflareContext();
  const contact = await getSetting(createDb(env.DB), "securityContactEmail");

  if (!contact) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const body = [
    `Contact: mailto:${contact}`,
    `Expires: ${expiryIso(new Date())}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE.url}/.well-known/security.txt`,
    // No Policy field. It is optional in RFC 9116 and must point at a policy
    // document; every deployment is a different operator with a different one,
    // and pointing it back at this file would say nothing.
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      // RFC 9116 requires text/plain, and charset is required by the spec
      "Content-Type": "text/plain; charset=utf-8",
      // Short cache: the address is editable, and a stale security contact is
      // the one kind of staleness that costs a report
      "Cache-Control": "public, max-age=300",
    },
  });
}
