import { PRICING } from "@/config/currency";
import { SITE } from "@/config/site";
import { getDb } from "@/db/client";
import { listAdmins } from "@/lib/admin/admins";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { requireOwner } from "@/lib/auth/guard";
import {
  changeRoleAction,
  createAdminAction,
  deleteAdminAction,
} from "./actions";

const field = "mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm";
const readOnly =
  "mt-1 w-full rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600";

export default async function AdminSettingsPage() {
  // 整页 owner 专属，不只是其中的账号管理
  const session = await requireOwner();
  const { locale, t } = await getAdminT();
  const admins = await listAdmins(getDb());

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t.settings.title}</h1>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t.settings.site}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            {t.settings.siteName}
            <div className={readOnly}>{SITE.name}</div>
          </label>
          <label className="text-sm">
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
        <h2 className="text-lg font-semibold">{t.settings.pricing}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            {t.settings.bufferRate}
            <div className={readOnly}>{(PRICING.bufferRate * 100).toFixed(1)}%</div>
          </label>
          <label className="text-sm">
            {t.settings.recalcThreshold}
            <div className={readOnly}>
              {(PRICING.recalcThreshold * 100).toFixed(1)}%
            </div>
          </label>
          <label className="text-sm">
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
        <h2 className="text-lg font-semibold">{t.settings.admins}</h2>

        <table className="mt-4 w-full border-collapse bg-white text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left">
              <th className="px-3 py-2">{t.customers.email}</th>
              <th className="px-3 py-2">{t.settings.role}</th>
              <th className="px-3 py-2">{t.customers.joined}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => {
              const isSelf = admin.id === session.userId;

              return (
                <tr key={admin.id} className="border-b border-neutral-100">
                  <td className="px-3 py-2">
                    {admin.email}
                    {isSelf ? (
                      <span className="ml-2 text-xs text-neutral-400">(you)</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
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
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {formatAdminDate(admin.createdAt, locale)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {/* 删自己的按钮直接不给：服务端也会拒，但不该让人点了才知道 */}
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
          className="mt-6 rounded border border-neutral-200 bg-white p-4"
        >
          <h3 className="font-medium">{t.settings.addAdmin}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              {t.customers.email}
              <input name="email" type="email" required className={field} />
            </label>
            <label className="text-sm">
              {t.login.password}
              <input
                name="password"
                type="password"
                required
                minLength={12}
                className={field}
              />
            </label>
            <label className="text-sm">
              {t.settings.role}
              <select name="role" defaultValue="staff" className={field}>
                <option value="staff">{t.settings.staff}</option>
                <option value="owner">{t.settings.owner}</option>
              </select>
            </label>
          </div>
          <button
            type="submit"
            className="mt-4 rounded bg-neutral-900 px-4 py-2 text-sm text-white"
          >
            {t.common.create}
          </button>
        </form>
      </section>
    </main>
  );
}
