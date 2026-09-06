import { PRICING } from "@/config/currency";
import { SITE } from "@/config/site";
import { getDb } from "@/db/client";
import { listAdmins } from "@/lib/admin/admins";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { requireOwner } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings/settings";
import { SecurityContactForm } from "./SecurityContactForm";
import {
  changeRoleAction,
  createAdminAction,
  deleteAdminAction,
} from "./actions";

const field = "mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm";
const readOnly =
  "mt-1 w-full rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600";

export default async function AdminSettingsPage() {
  // The whole page is owner-only, not merely the account management on it
  const session = await requireOwner();
  const { locale, t } = await getAdminT();
  const admins = await listAdmins(getDb());
  const settings = await getSettings(getDb());

  return (
    <>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 650, letterSpacing: "-0.02em", margin: 0 }}>{t.settings.title}</h1>

      <section className="mt-8">
        <h2 className="mb-4 text-base font-semibold tracking-tight">{t.settings.site}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {t.settings.siteName}
            <div className={readOnly}>{SITE.name}</div>
          </label>
          <label className="text-sm font-medium">
            {t.settings.siteUrl}
            <div className={readOnly}>{SITE.url}</div>
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          These come from <code>src/config/site.ts</code> and{" "}
          <code>NEXT_PUBLIC_SITE_URL</code>. They are build-time values because
          canonical URLs and hreflang are baked into statically generated pages.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-base font-semibold tracking-tight">{t.settings.security}</h2>
        <SecurityContactForm
          initialValue={settings.securityContactEmail}
          labels={{
            email: t.settings.securityEmail,
            hint: t.settings.securityHint,
            inbound: t.settings.securityInbound,
            invalid: t.settings.securityInvalid,
            save: t.settings.save,
            saved: t.settings.saved,
          }}
        />
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-base font-semibold tracking-tight">{t.settings.pricing}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium">
            {t.settings.bufferRate}
            <div className={readOnly}>{(PRICING.bufferRate * 100).toFixed(1)}%</div>
          </label>
          <label className="text-sm font-medium">
            {t.settings.recalcThreshold}
            <div className={readOnly}>
              {(PRICING.recalcThreshold * 100).toFixed(1)}%
            </div>
          </label>
          <label className="text-sm font-medium">
            {t.settings.rounding}
            <div className={readOnly}>{PRICING.roundingStrategy}</div>
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Defined in <code>src/config/currency.ts</code>. Changing them affects
          every auto-converted price on the next exchange-rate run.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-base font-semibold tracking-tight">{t.settings.admins}</h2>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr >
              <th>{t.customers.email}</th>
              <th>{t.settings.role}</th>
              <th>{t.customers.joined}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => {
              const isSelf = admin.id === session.userId;

              return (
                <tr key={admin.id} >
                  <td>
                    {admin.email}
                    {isSelf ? (
                      <span className="ml-2 text-xs text-neutral-400">(you)</span>
                    ) : null}
                  </td>
                  <td>
                    <form action={changeRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="targetId" value={admin.id} />
                      <select
                        name="role"
                        defaultValue={admin.role}
                        className="rounded border border-neutral-300 px-2 py-1 text-sm"
                      >
                        <option value="owner">{t.settings.owner}</option>
                        <option value="staff">{t.settings.staff}</option>
                      </select>
                      <button type="submit" className="text-xs underline">
                        {t.common.save}
                      </button>
                    </form>
                  </td>
                  <td>
                    {formatAdminDate(admin.createdAt, locale)}
                  </td>
                  <td>
                    {/* No delete button for yourself: the server refuses it too, but
                        nobody should have to click to find that out */}
                    {isSelf ? (
                      <span className="text-xs text-neutral-400">
                        {t.settings.cannotRemoveSelf}
                      </span>
                    ) : (
                      <form action={deleteAdminAction}>
                        <input type="hidden" name="targetId" value={admin.id} />
                        <button type="submit" className="text-xs text-red-700 underline">
                          {t.settings.removeAdmin}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <form
          action={createAdminAction}
          className="rounded-xl border bg-card p-5" style={{ marginTop: "1.5rem" }}
        >
          <h3 className="font-medium">{t.settings.addAdmin}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium">
              {t.customers.email}
              <input name="email" type="email" required className={field} />
            </label>
            <label className="text-sm font-medium">
              {t.login.password}
              <input
                name="password"
                type="password"
                required
                minLength={12}
                className={field}
              />
            </label>
            <label className="text-sm font-medium">
              {t.settings.role}
              <select name="role" defaultValue="staff" className={field}>
                <option value="staff">{t.settings.staff}</option>
                <option value="owner">{t.settings.owner}</option>
              </select>
            </label>
          </div>
          <button
            type="submit"
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80" style={{ marginTop: "1rem" }}
          >
            {t.common.create}
          </button>
        </form>
      </section>
    </>
  );
}
