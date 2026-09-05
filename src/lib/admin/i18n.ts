/**
 * 后台界面语言。
 *
 * **这与前台的内容语言（en/de/fr/es）是两套东西**，刻意不复用同一份配置：
 * 前台语言面向海外买家、由 URL 前缀决定、影响 SEO；后台语言面向运营，
 * 由 cookie 决定、与 SEO 无关。把两者混为一谈，将来加一门买家语言就会
 * 莫名其妙地要求补一份后台翻译。
 *
 * 不引入 i18n 库：后台文案约 150 条、只有中英两种、几乎不需要复数规则，
 * 而数字与日期本地化用运行时内置的 Intl 即可。
 */
export const ADMIN_LOCALES = ["zh", "en"] as const;

export type AdminLocale = (typeof ADMIN_LOCALES)[number];

export const DEFAULT_ADMIN_LOCALE: AdminLocale = "zh";

export const ADMIN_LOCALE_COOKIE = "kontor_admin_lang";

export const ADMIN_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isAdminLocale(value: string): value is AdminLocale {
  return (ADMIN_LOCALES as readonly string[]).includes(value);
}

export function parseAdminLocale(
  raw: string | undefined | null,
  fallback: AdminLocale = DEFAULT_ADMIN_LOCALE,
): AdminLocale {
  return raw && isAdminLocale(raw) ? raw : fallback;
}

/**
 * 文案字典。
 *
 * 用嵌套对象而非扁平点号键：TypeScript 能对整棵树做补全和穷尽检查，
 * 漏翻一条在编译期就报错，不用等运行时看到空白。
 */
const MESSAGES = {
  zh: {
    nav: {
      overview: "概览",
      products: "商品",
      orders: "订单",
      customers: "客户",
      translations: "翻译",
      settings: "设置",
      signOut: "退出",
      language: "界面语言",
    },
    common: {
      save: "保存",
      cancel: "取消",
      create: "新建",
      delete: "删除",
      edit: "编辑",
      back: "返回",
      search: "搜索",
      none: "无",
      all: "全部",
      loading: "加载中…",
      confirm: "确认",
      required: "必填",
      optional: "选填",
    },
    login: {
      title: "Kontor 后台",
      email: "邮箱",
      password: "密码",
      submit: "登录",
      invalid: "邮箱或密码不正确。",
      locked: "失败次数过多，请 15 分钟后再试。",
    },
    overview: {
      title: "概览",
      signedInAs: "当前登录",
      activeProducts: "在售商品",
      exchangeRates: "汇率条目",
      ratesUpdated: "汇率更新于",
      never: "从未",
      revenue: "已支付营收",
      pendingOrders: "待处理订单",
    },
    products: {
      title: "商品",
      newProduct: "新建商品",
      name: "名称",
      slug: "URL 标识",
      status: "状态",
      skus: "SKU 数",
      from: "起价",
      translations: "翻译完整度",
      complete: "已完成",
      missing: "缺少",
      empty: "还没有商品。",
      contentSeo: "内容与 SEO",
      pricingStock: "定价与库存",
      applications: "使用工况",
      basePrice: "基准价",
      stock: "库存",
      moq: "最小起订量",
      leadTimeMin: "交期下限",
      leadTimeMax: "交期上限",
      ownPage: "独立成页",
      urlSlug: "URL 片段",
      notTranslated: "尚未翻译",
      seoTitleHint: "控制在 60 字符内，避免被 Google 截断。",
      seoDescHint: "建议 150–160 字符。",
      images: "图片",
      primaryImage: "主图",
      gallery: "轮播图",
      altText: "替代文本",
      altRequired: "替代文本必填——它既是无障碍要求，也是图片排名信号。",
    },
    orders: {
      title: "订单",
      order: "订单号",
      status: "状态",
      total: "金额",
      locale: "语言",
      placed: "下单时间",
      empty: "还没有订单。",
      items: "商品明细",
      shipTo: "收货地址",
      actions: "操作",
      trackingNo: "物流单号",
      markShipped: "标记已发货",
      markDelivered: "标记已送达",
      refund: "退款",
      cancel: "取消订单",
      oversoldWarning:
        "已扣款但库存售罄。请为此单退款并联系客户。",
      subtotal: "小计",
      shipping: "运费",
    },
    customers: {
      title: "客户",
      email: "邮箱",
      orders: "订单数",
      spent: "累计消费",
      joined: "注册时间",
      empty: "还没有客户。",
      addresses: "地址",
      orderHistory: "订单历史",
    },
    translations: {
      title: "翻译",
      comparedAgainst: "与源语言对照",
      coverage: "覆盖率",
      source: "源语言",
      fullyTranslated: "已完整翻译为",
      missingFields: "缺少字段",
      untranslatedFeatures: "未翻译的特性",
      untranslatedApplications: "未翻译的工况",
      noProducts: "还没有在售商品。",
    },
    settings: {
      title: "设置",
      site: "站点",
      siteName: "站点名称",
      siteUrl: "站点地址",
      pricing: "定价参数",
      bufferRate: "汇率缓冲",
      recalcThreshold: "重算阈值",
      rounding: "取整策略",
      admins: "管理员",
      addAdmin: "添加管理员",
      role: "角色",
      owner: "所有者",
      staff: "员工",
      removeAdmin: "移除",
      cannotRemoveSelf: "不能移除自己的账号。",
    },
  },

  en: {
    nav: {
      overview: "Overview",
      products: "Products",
      orders: "Orders",
      customers: "Customers",
      translations: "Translations",
      settings: "Settings",
      signOut: "Sign out",
      language: "Interface language",
    },
    common: {
      save: "Save",
      cancel: "Cancel",
      create: "Create",
      delete: "Delete",
      edit: "Edit",
      back: "Back",
      search: "Search",
      none: "None",
      all: "All",
      loading: "Loading…",
      confirm: "Confirm",
      required: "Required",
      optional: "Optional",
    },
    login: {
      title: "Kontor admin",
      email: "Email",
      password: "Password",
      submit: "Sign in",
      invalid: "Incorrect email or password.",
      locked: "Too many failed attempts. Try again in 15 minutes.",
    },
    overview: {
      title: "Overview",
      signedInAs: "Signed in as",
      activeProducts: "Active products",
      exchangeRates: "Exchange rates",
      ratesUpdated: "Rates updated",
      never: "never",
      revenue: "Paid revenue",
      pendingOrders: "Orders awaiting action",
    },
    products: {
      title: "Products",
      newProduct: "New product",
      name: "Name",
      slug: "Slug",
      status: "Status",
      skus: "SKUs",
      from: "From",
      translations: "Translations",
      complete: "complete",
      missing: "missing",
      empty: "No products yet.",
      contentSeo: "Content & SEO",
      pricingStock: "Pricing & stock",
      applications: "Applications",
      basePrice: "Base price",
      stock: "Stock",
      moq: "Minimum order quantity",
      leadTimeMin: "Lead time min",
      leadTimeMax: "Lead time max",
      ownPage: "Own page",
      urlSlug: "URL slug",
      notTranslated: "not translated yet",
      seoTitleHint: "Aim for under 60 characters so Google does not truncate it.",
      seoDescHint: "Aim for 150–160 characters.",
      images: "Images",
      primaryImage: "Primary image",
      gallery: "Gallery",
      altText: "Alt text",
      altRequired:
        "Alt text is required — it is both an accessibility requirement and an image ranking signal.",
    },
    orders: {
      title: "Orders",
      order: "Order",
      status: "Status",
      total: "Total",
      locale: "Locale",
      placed: "Placed",
      empty: "No orders yet.",
      items: "Items",
      shipTo: "Ship to",
      actions: "Actions",
      trackingNo: "Tracking number",
      markShipped: "Mark shipped",
      markDelivered: "Mark delivered",
      refund: "Refund",
      cancel: "Cancel",
      oversoldWarning:
        "Payment succeeded but stock had already sold out. Refund this order and contact the customer.",
      subtotal: "Subtotal",
      shipping: "Shipping",
    },
    customers: {
      title: "Customers",
      email: "Email",
      orders: "Orders",
      spent: "Lifetime value",
      joined: "Joined",
      empty: "No customers yet.",
      addresses: "Addresses",
      orderHistory: "Order history",
    },
    translations: {
      title: "Translations",
      comparedAgainst: "Compared against the source language",
      coverage: "Coverage",
      source: "source",
      fullyTranslated: "Fully translated into",
      missingFields: "Missing fields",
      untranslatedFeatures: "Untranslated features",
      untranslatedApplications: "Untranslated applications",
      noProducts: "No active products yet.",
    },
    settings: {
      title: "Settings",
      site: "Site",
      siteName: "Site name",
      siteUrl: "Site URL",
      pricing: "Pricing parameters",
      bufferRate: "Exchange buffer",
      recalcThreshold: "Recalculation threshold",
      rounding: "Rounding strategy",
      admins: "Administrators",
      addAdmin: "Add administrator",
      role: "Role",
      owner: "Owner",
      staff: "Staff",
      removeAdmin: "Remove",
      cannotRemoveSelf: "You cannot remove your own account.",
    },
  },
} as const;

/**
 * 中文是字典的权威结构，英文必须一一对应。
 *
 * 把字面量类型放宽成 string 再做结构比对：`as const` 会让每条中文成为
 * 字面量类型（"概览"），直接约束英文就会要求英文也等于那个中文字符串。
 * 这里只校验**结构**，不校验取值。漏翻一条会在编译期报错，
 * 而不是等运行时页面上显示 undefined。
 */
type Widen<T> = T extends string
  ? string
  : { [K in keyof T]: Widen<T[K]> };

export type AdminMessages = Widen<(typeof MESSAGES)["zh"]>;

const CATALOGUE: Record<AdminLocale, AdminMessages> = MESSAGES;

export function getAdminMessages(locale: AdminLocale): AdminMessages {
  return CATALOGUE[locale];
}

/** 按后台界面语言格式化日期，用运行时内置的 Intl，不引入日期库 */
export function formatAdminDate(
  epochSeconds: number,
  locale: AdminLocale,
): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}
